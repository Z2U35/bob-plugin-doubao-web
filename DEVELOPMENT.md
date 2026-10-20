# Development

Bob 1.21+ plugin and a macOS 13+ native login companion. No npm or Swift package dependencies.

## Components

- `plugin/main.js`: Bob entry points.
- `plugin/core.js`: fixed translation protocol, language mapping, SSE/UTF-8 parser.
- `plugin/runner.js`: direct Doubao requests, cancellation, initialization and session selection.
- `plugin/helper.js`: authenticated loopback pairing and session retrieval; manual mode remains available.
- `helper/BridgeCore.swift`: HTTP framing, cookie scoping, Keychain wrapper and pairing state.
- `helper/LoopbackServer.swift`: bounded Network.framework loopback listener.
- `helper/main.swift`: AppKit UI, independent non-persistent WKWebView and explicit pairing consent.

## Tests

```sh
node --test tests/*.test.cjs
mkdir -p build
xcrun swiftc -swift-version 5 helper/BridgeCore.swift helper/tests/CoreTests.swift -o build/helper-tests
build/helper-tests
```

The native core tests use synthetic Cookie values and never open Keychain or a real login session.
The JavaScript tests simulate Bob APIs, not Bob's real native network layer.

## Build and Release

Requires Node.js 18+, Python 3.9+, macOS and Xcode Command Line Tools with Swift 5.7+.

```sh
python3 tools/build-helper.py --output-dir dist --build-dir build
node tools/smoke-anonymous.cjs --output build/anonymous-smoke.json
python3 tools/build.py --output-dir dist --smoke-report build/anonymous-smoke.json --write-appcast
```

The helper build creates arm64 and x86_64 binaries, merges them into a universal app,
and applies an ad-hoc signature. It does not sign with Developer ID or notarize.
For a new release, first update versions in plugin metadata, native Info.plist/main.swift,
README links and release notes. Build, inspect archives, commit the generated appcast,
then publish the exact matching assets to the GitHub Release. Do not amend published assets silently.

Plugin archives have their metadata at the ZIP root. Source archives use an explicit allowlist.
Neither source nor release packages may include cookies, pairing files, screenshots, HAR files,
Keychain exports, private local paths or browser profiles.

## Protocol

The translation protocol was observed in a user-provided Cometix Translate 1.32.7.108 package;
this repository contains a separately written adapter, not the extension distribution.
All three providers use the same Doubao web endpoint. There is no official API-key integration here.

The companion's public health route contains only app/version metadata. Session routes require a
locally approved token. The non-secret pairing client ID is a stable device identifier, not authentication.
The random request capability expires in 180 seconds; Bob must verify the native confirmation code.

No claims are made that QR login always works in WKWebView. Main-frame navigation is restricted
to Doubao's own hosts; unsupported external SSO must use manual Cookie mode, not relaxed origin checks.

## Manual Acceptance Still Required

1. On a clean Mac, install the helper and plugin.
2. Complete login on the real Doubao page (QR or whichever official method is offered).
3. Compare and approve the first pairing code; validate again in Bob.
4. Verify real English/Chinese translations and each alternate provider.
5. Relaunch the helper and verify restored login and pairing.
6. Revoke pairing and confirm requests fail; clear the session and confirm re-login is needed.
7. Verify cancellation and account-expiry behavior with Bob's real network runtime.

Do not claim this manual checklist passed solely from mock or anonymous tests.
