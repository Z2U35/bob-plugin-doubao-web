# Changelog

## 0.2.1 — 2026-10-20 — Private Test Preview

- Make manual Cookie the default and first option, with official-site login and request-header copying guidance.
- Keep the original 0.2.0 login helper as an optional alternative; preserve pairing and explicit legacy `auto` settings.
- Never contact the helper in manual mode, including missing, malformed or expired Cookie cases.
- Keep manual and helper authentication errors specific to the selected credential source.
- Expand regression tests for defaults, validation, source isolation, mode switching and upgrade compatibility.
- Reorder the README around manual setup and document the private-repository update limits.
- Keep the repository private until real Bob translation and both login paths are manually accepted.

## 0.2.0 — 2026-10-20 — Test Preview

- First public repository and GitHub release, using identifier `com.z2u35.bob.doubaoweb`.
- Add a macOS native official-site login window, scoped cookie observation and Keychain persistence.
- Add explicit local pairing, authenticated loopback access and automatic Bob session retrieval.
- Keep manual Cookie mode and all three translation services.
- Add security documentation, native protocol tests, public-source checks and appcast updates.
- Authenticated QR login and Bob-native translation remain unverified; no official endorsement.

## 0.1.0 — Local Prototype

- Direct translation adapter, manual Cookie configuration, SSE parsing and offline tests.
- Not published as a GitHub release. Private prototype identifiers are not reused in the public release.
