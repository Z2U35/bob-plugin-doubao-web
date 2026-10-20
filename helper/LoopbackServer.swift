import Foundation
import Network

final class LoopbackServer {
    private let queue = DispatchQueue(label: "com.z2u35.doubaobob.loopback")
    private var listener: NWListener?
    private var clients = 0
    var handle: ((HTTPRequest, @escaping (HTTPReply) -> Void) -> Void)?
    var stateChanged: ((Bool) -> Void)?

    func start() throws {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: BridgePolicy.port)!)
        let listener = try NWListener(using: parameters)
        self.listener = listener
        listener.stateUpdateHandler = { [weak self] state in
            if case .ready = state { DispatchQueue.main.async { self?.stateChanged?(true) } }
            if case .failed = state { DispatchQueue.main.async { self?.stateChanged?(false) } }
        }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
        listener.start(queue: queue)
    }

    private func accept(_ connection: NWConnection) {
        guard clients < 12 else { connection.cancel(); return }
        clients += 1
        var closed = false
        func close() {
            guard !closed else { return }
            closed = true
            self.clients -= 1
            connection.cancel()
        }
        let deadline = DispatchWorkItem { close() }
        queue.asyncAfter(deadline: .now() + 10, execute: deadline)
        func reply(_ response: HTTPReply) {
            guard !closed else { return }
            deadline.cancel()
            connection.send(content: response.data, completion: .contentProcessed { _ in close() })
        }
        func receive(_ buffer: Data) {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self] chunk, _, complete, error in
                guard let self, !closed else { return }
                let combined = buffer + (chunk ?? Data())
                do {
                    if let request = try HTTPRequest.parse(combined) {
                        guard BridgePolicy.accepts(request) else {
                            reply(HTTPReply(status: 403, json: ["error": "forbidden"])); return
                        }
                        DispatchQueue.main.async {
                            self.handle?(request) { response in self.queue.async { reply(response) } }
                        }
                    } else if complete || error != nil { close() }
                    else { receive(combined) }
                } catch {
                    reply(HTTPReply(status: 400, json: ["error": "invalid_request"]))
                }
            }
        }
        connection.start(queue: queue)
        receive(Data())
    }
}
