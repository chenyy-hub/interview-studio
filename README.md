# Interview Studio

Chinese desktop interview/meeting assistant, based on the pinned Pika 3.4.0
runtime, with the editable extension under `desktop/`. Version: **0.5.0**.

## This update

- Bounded local material selection, separate quick/deep context budgets, direct
  OpenAI-compatible SSE streaming for text, and non-thinking quick answers on
  the official DeepSeek endpoint. No silent provider retries or model switching.
- First-visible-text/idle timeouts, immediate cancellation even if a provider
  ignores abort, partial-column history, and animation-frame rendering.
- Default system-audio capture with optional microphone: ScreenCaptureKit on
  macOS, WASAPI loopback on Windows. The OS default device is not changed.
- Shared-window protection requests, one shortcut to hide/restore app windows,
  and explicitly user-reported Feishu/Tencent sharing-test records. A flag is
  never presented as proof that a meeting receiver cannot see a window.
- Windows x64 compilation and installer workflow using the exact upstream
  commit in `UPSTREAM_LOCK.json`; native audio is compiled on Windows.

## Validation

```sh
node --test desktop/*.test.cjs
python3 desktop/build_macos_test.py
```

These use synthetic data, local streams and provider stubs. Real ASR accuracy,
provider latency, Feishu/Tencent screen sharing, Bluetooth devices and Windows
hardware still need end-to-end testing. Do not infer those results from unit
tests, packaging or a successful startup.

## Windows

Run the **Windows Desktop Build** workflow. It checks out the pinned upstream,
builds its renderer/main/native addon, applies this extension, and creates a
per-user installer plus a portable x64 executable. Packaged browser startup and
native dependencies are checked before artifacts are uploaded. No Windows
code-signing certificate is configured; this is a development build.

## macOS local build

```sh
python3 desktop/build_macos.py /path/to/official/Pika.app /path/to/new/InterviewStudio.app
```

The adapter requires the official Pika 3.4.0 arm64 runtime, preserves its native
modules and ASAR integrity, validates helper names and signs the local derivative.
The output directory must not exist. This build is not notarized.

API credentials default to process memory only. Existing encrypted credentials
are loaded only after an explicit user action. Application records are local.

See `ASSESSMENT.md` for the GitHub alternatives review, and
`desktop/FEATURES.md` for the earlier feature comparison and remaining gaps.

## License and provenance

AGPL-3.0-only; see `LICENSE`. Upstream:
https://github.com/royisme/pikabaka/tree/v3.4.0

This repository contains the derivative extension and reproducible build
adapter. The corresponding upstream source is pinned, fetched and built by the
Windows workflow. It is not an official Pika or Interview Genie release.
