# Development

Bob 1.21+ plugin, defaulting to manual Cookie input, with an optional macOS 13+ native login companion.
No npm or Swift package dependencies. Plugin 0.2.1 remains compatible with the unchanged 0.2.0 helper.

## Components

- `plugin/main.js`: Bob entry points.
- `plugin/core.js`: fixed translation protocol, language mapping, SSE/UTF-8 parser.
- `plugin/runner.js`: direct Doubao requests, cancellation, initialization and session selection.
- `plugin/helper.js`: optional authenticated loopback pairing and session retrieval; never used by manual mode.
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
They cover default/manual/helper/legacy-auto routing, missing and expired cookies, mode switching,
and the invariant that manual mode never reads pairing files or contacts the local helper.

New or unset options default to `manual`. Explicit `helper` and legacy `auto` values remain compatible;
the plugin does not rewrite users' saved options. `auto` selects the helper only when Cookie is blank,
not when a supplied Cookie is invalid or expired. Do not add silent cross-account fallback.

## Build and Release

Requires Node.js 18+, Python 3.9+, macOS and Xcode Command Line Tools with Swift 5.7+.

```sh
python3 tools/build-helper.py --output-dir dist --build-dir build
node tools/smoke-anonymous.cjs --output build/anonymous-smoke.json
python3 tools/build.py --output-dir dist --smoke-report build/anonymous-smoke.json --write-appcast
```

For a plugin-only package that still regression-tests the unchanged helper:

```sh
python3 tools/build.py --output-dir dist --test-helper --write-appcast
```

`--test-helper` runs only synthetic native core tests, does not open the app or Keychain,
and records the result in the package's test report.
The helper build creates arm64 and x86_64 binaries, merges them into a universal app,
and applies an ad-hoc signature. It does not sign with Developer ID or notarize.
Plugin and helper versions are independent: update plugin metadata for plugin changes; update native
Info.plist/main.swift only when releasing a new helper. Also update README links and release notes.
Build, inspect archives, commit the generated appcast,
then publish the exact matching assets to the GitHub Release. Do not amend published assets silently.
Upload only the Bob `.bobplugin` and the optional login-helper ZIP to the release.
Keep generated installation guides, test reports, checksum files and custom source ZIPs local;
GitHub already supplies source archives from the release tag.
Put the helper ZIP in the same release as the plugin and point README downloads to that release's assets.
Keep this repository private during testing. A private prerelease is not public acceptance; do not change
visibility or claim Bob-list inclusion automatically after CI. Anonymous appcast access is not guaranteed
for private repositories, so authorized testers should download the plugin manually.

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

### Default manual Cookie path

1. Install the plugin without running or installing the helper; create a new Bob service.
2. Confirm manual mode is selected by default. Validate with Cookie blank: the error should show login/copying
   guidance and an official-site link; it must not prompt for helper installation or pairing.
3. Log in to Doubao in an existing browser, copy the complete Cookie request header, paste it into Bob and validate.
4. Verify real English/Chinese translations and each alternate provider.
5. Confirm an expired or malformed Cookie asks for manual renewal and never changes to a helper session.
6. Verify cancellation and request failures with Bob's real network runtime.

### Optional helper and upgrade path

1. Install or reuse the original 0.2.0 helper; explicitly select helper mode in Bob.
2. Complete login on the real Doubao page (QR or whichever official method is offered).
3. Compare and approve the first pairing code; validate again in Bob.
4. Verify real English/Chinese translations and each alternate provider.
5. Relaunch the helper and verify restored login and pairing.
6. Switch to manual mode and verify the manually supplied session is used without losing the helper pairing.
7. Switch back to helper mode, revoke pairing and confirm requests fail; clear the session and confirm re-login is needed.
8. Upgrade a service configured as `auto` or `helper` in 0.2.0; confirm its explicit selection remains usable.

Do not claim this manual checklist passed solely from mock or anonymous tests, and do not make the repository
public until the repository owner approves the tested result.
