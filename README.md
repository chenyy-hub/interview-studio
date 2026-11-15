# Interview Studio

Chinese desktop interview/meeting assistant, based on the pinned Pika 3.4.0
runtime, with the editable extension under `desktop/`. Version: **0.8.1**.

## This update

- Floating text and controls now share one saved overall opacity. Hovering or
  focusing the composer no longer reveals bright top/bottom bars. The zero
  background preset removes the main panel's fills, borders and shadow.
- Explicit **清晰编辑** temporarily restores readability; ending editing,
  hiding the overlay or leaving floating mode restores the saved opacity.
  Existing opacity preferences are preserved without reconfiguration.
- Native Windows title bar and desktop-fit sizing, with real packaged window
  maximize/restore, minimize and close checks before installer compression.
- Warm-white and charcoal palettes, simple provider presets and a Chinese
  floating interface sharing the same transcript, answer stream and history.
- Independently saved floating background (0–100%), overall opacity (15–100%) and font size;
  transparent-text preset, collapse, drag/resize, click-through and tray recovery.
- Global floating/quick-answer/screenshot/scroll shortcuts with conflict status.
  Upstream mode changes now release only their own shortcuts, preserving recovery.
- Soniox v6, Chinese and other provider defaults are prefilled; streaming versus
  chunked-upload and short-request billing differences are explained in settings.

- Saved interview preparation: company, role, job description, selected resume,
  answer language/style and programming language. One language setting applies
  to the workbench prompts instead of conflicting controls.
- Selected resumes up to 4,000 characters are included whole; longer documents
  stay within retrieval budgets. Visible context ranges can be previewed, with
  content-version checks that reject stale previews. These are supplied inputs,
  not claims that a model cited or verified a document.
- Resume import is one action, duplicate text is reused, and removed resumes
  clear the selection. Full chat-completions URLs normalize to API base URLs.

- Six everyday navigation entries and one setup page. Advanced audio, speed,
  privacy and diagnostics are collapsed; the session source chooser opens
  before audio starts. Screenshot-and-ask is one explicit user action.
- Account-local API persistence: save endpoint, model and chat/speech keys once,
  restore automatically on startup, with explicit clear and legacy import.

- Bounded local material selection, separate quick/deep context budgets, direct
  OpenAI-compatible SSE streaming for text, and non-thinking quick answers on
  the official DeepSeek endpoint. The direct text route does not silently retry
  or switch models; other provider protocols retain the upstream SDK behavior.
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

Download the individual Setup executable from the private repository's
[latest installer](https://github.com/chenyy-hub/interview-studio/releases/latest/download/InterviewStudio-Windows-Setup.exe).
The portable executable is an alternative; users do not need both. Release
assets retain the original verified build checksums and do not expire with
the Actions artifact. Repository access is required.

Run the **Windows Desktop Build** workflow. It checks out the pinned upstream,
builds its renderer/main/native addon, applies this extension, and creates a
per-user installer plus a portable x64 executable. Packaged browser startup and
native dependencies are checked before artifacts are uploaded. No Windows
code-signing certificate is configured; this is a development build.

For release transfer, the trusted publisher creates a tag and draft release for
the verified build commit first. **Publish Windows Installers** checks the tag,
build and checksums, and uploads individual files. The publisher checks the
assets and publishes the draft. No long-lived personal token is stored in Actions.

## macOS local build

Apple Silicon users can download
[the latest Mac ZIP](https://github.com/chenyy-hub/interview-studio/releases/latest/download/InterviewStudio-macOS-arm64.zip).
Quit the previous app, unzip and replace InterviewStudio.app. This is an arm64
build; it is not an Intel Mac package. Both platform downloads share a release.

```sh
python3 desktop/build_macos.py /path/to/official/Pika.app /path/to/new/InterviewStudio.app
```

The adapter requires the official Pika 3.4.0 arm64 runtime, preserves its native
modules and ASAR integrity, validates helper names and signs the local derivative.
The output directory must not exist. This build is not notarized.

API credentials are saved in an AES-256-GCM file in the app user-data private
directory and restored without keychain prompts. Its random key is stored in
the same account directory (0700 directory / 0600 files on Unix). This protects
against casual plaintext exposure, not programs or administrators with access
to that account. It is not equivalent to OS-keychain storage. Corrupt or
missing-key vaults block writes rather than overwrite saved data. Legacy OS
encrypted credentials are imported only after an explicit user action.
Application records and credentials are never included in this repository.

See `ASSESSMENT.md` for the GitHub alternatives review, and
`desktop/FEATURES.md` for the earlier feature comparison and remaining gaps.

## License and provenance

AGPL-3.0-only; see `LICENSE`. Upstream:
https://github.com/royisme/pikabaka/tree/v3.4.0

This repository contains the derivative extension and reproducible build
adapter. The corresponding upstream source is pinned, fetched and built by the
Windows workflow. It is not an official Pika or Interview Genie release.

The reviewed Interview Genie documentation and remaining gaps are in
`GENIE_FEATURES.md`. Windows build results are tracked in the private
repository Actions, not inferred from local configuration checks.
