# Interview Studio desktop extension

This directory is the editable source of the Chinese desktop extension. It is
packaged into a real macOS `.app`, with Pika's native audio, window, screenshot,
provider, translation and meeting modules retained. It does not use the earlier
standalone workbench HTTP preview server.

## Runtime and source provenance

The local build adapter targets the official **Pika 3.4.0 arm64 app release**.
The larger source tree downloaded earlier is Pika 3.5.0 and is a reference tree,
not a claim that its TypeScript was compiled for this executable. The adapter
checks the runtime version and the exact code shapes it patches. Upstream source
for that runtime: https://github.com/royisme/pikabaka/tree/v3.4.0

The upstream AGPL-3.0-only license is preserved. This is a local development
derivative, not an official Pika release or a notarized production release.

## Build

```sh
python3 desktop/build_macos.py /path/to/official/Pika.app /path/to/new/InterviewStudio.app
```

The output must not exist. The adapter preserves native dependencies and
ASAR integrity, adds the extension files, sets an independent app identity and
data paths, and applies a local ad-hoc signature. It does not remove quarantine,
change Gatekeeper or modify the installed Interview Genie app. Upstream automatic
updates are off so an upstream package cannot replace this derivative.

The main executable, bundle name and all four Electron helper bundles must use
the same product name. The builder now validates this before signing. The old
mixed Pika/Interview Studio names caused a native "Unable to find helper app"
startup crash. The overlay close handler also respects the app's quitting state,
so quitting releases the single-instance lock and allows a normal relaunch.
The final shutdown explicitly stops audio and exits after the upstream agent
cleanup and credential scrub finish; the final GUI check confirmed that the
Chromium launch lock was actually removed before relaunch.

## API credentials and password prompts

The Chinese extension saves its configuration in this OS account's private app-data directory. It does not ship credentials or transcripts in release archives. This account-local storage is not an OS-keychain security boundary; another process with equivalent account access can read the same files. Legacy OS-encrypted import remains an explicit action.

## Current flow and build adapter

`runtime_payload.py` packages the extension and applies `runtime-patches.json` against the exact pinned upstream compiled code. Every source anchor must match once. The patches cover system/user audio routing, 30-second turn assembly, speech drain on stop, optional-microphone reconfiguration, recovery status and Windows file URLs. Package metadata points to this fork.

The written workspace uses independent drafts and an explicit image/text mode. Native Windows OCR scales to the engine's supported dimensions and preserves editable lines; OCR cannot verify diagrams, code indentation or mathematical layout. Repeat-region screenshot capture never moves the OS pointer and does not reopen the cropper. It does not guarantee that a meeting receiver cannot see the system pointer.

`check_windows_package.cjs` tests the actual packaged workbench, preload, CSP, keyboard flows, hidden-window restoration and native dependencies. A CI host without an OCR language pack may use an explicitly labeled OCR fixture. Set `STUDIO_REQUIRE_LOCAL_OCR=1` to require actual local OCR, as used for the Windows validation on the development machine.

## Connected behavior

- Chinese connection setup for OpenAI-compatible answer models (including
  DeepSeek), and separate Deepgram/Groq/OpenAI speech keys. Saving settings
  makes no model request; explicit tests may call a provider.
- Speech preflight checks before starting a meeting, including starts from the
  original Pika UI; unconfigured speech returns to the Chinese setup page.
- System-only audio by default via ScreenCaptureKit. The optional microphone
  is separate: no microphone permission, native input or user STT stream is
  opened in system-only mode. Users may select the Core Audio Tap backend and
  a playback device, without changing the OS default or meeting-app settings.
- Native audio setup, device selection and Pika's additional STT configuration.
- Device enumeration is on demand in a headless child with an eight-second
  limit, including the original Pika settings IPC routes. Enumeration failed on
  this Mac during verification; the UI remained responsive and offered the
  system defaults. Individual-device listing is therefore not marked verified.
- Native screenshot and region selection, four image attachments per request.
- Chinese interview, written-practice, resume and review tasks, with optional
  two-column model generation, cancellation and explicit provider errors.
- Import TXT, MD, DOCX and text-based PDF; local notes and document text feed
  the workbench and original overlay's shared streaming helper. This full-text
  context is separate from Pika's original vector knowledge interface.
- Actual successful answer history and Markdown exports through native dialogs.
- Deterministic glossary replacements with original transcript retained;
  optional question-pattern auto-answering, off by default.
- One local-network phone client with an expiring bearer link; no public relay.
- OS speech synthesis, original floating window, shortcut and translation pages.
- Measured model first-content and completion times; no invented STT accuracy.
- Transcript/answer state restoration after settings navigation; old requests
  abort when a meeting ends or a new meeting resets the session.

Settings are available through the existing full Pika page. Use the macOS menu
`面试工作室 > 返回中文工作台` or Cmd+Shift+H to return.

## Validation and limits

```sh
node --test desktop/*.test.cjs
python3 desktop/build_macos_test.py
```

The sixteen Node tests and four Python tests use synthetic fixtures and provider stubs. The native integration
test additionally checks shared context, saved-answer hydration, real transcript
event mirroring and cancellation at session reset. The renderer test uses a
non-configurable global, matching Electron contextBridge, to catch startup
redeclaration errors. Credential tests cover zero keychain/disk access by default,
explicit encrypted saving, unlock refusal and prevention of plaintext fallback.

`runtime-smoke.cjs` runs inside the packaged Electron runtime with
`ELECTRON_RUN_AS_NODE=1`. It verifies the packaged SQLite, WebSocket dependency,
DOCX parser, PDF parser and audio module import. It opens no window, records
no audio and makes no model request. On this Mac, the built app was actually
opened, its ready state and diagnostics/speech pages inspected, settings opened,
the Chinese workbench restored and normal quit/relaunch verified. No login-keychain
password was entered for those checks. Microphone/system capture, real provider
behavior, screen-sharing privacy and local-network pairing still need end-to-end
checks with user configuration. Do not treat successful module loading as
successful capture or transcription.

Final v0.4 UI verification: Chinese connection forms and system-only microphone
default were visible; unconfigured Start opened setup without recording; the
device-list timeout left the UI responsive; advanced model settings opened on
the correct tab; quitting removed the launch lock and the same app relaunched.
The final app was left on its Chinese service configuration page.

The packaged-runtime smoke also constructs the actual patched microphone
wrapper using the real native addon and verifies it leaves native input unopened.
It tests the native camelCase sample-rate accessor (fixing the upstream snake_case
lookup), and executes the actual packaged startMeeting method with synthetic
capture stubs in system-only and optional-microphone modes. This verifies the
permission/start branches, not coexistence with a live meeting or real ASR.

See `FEATURES.md` for observed Interview Genie behavior, implemented pieces and
remaining gaps. There is no verified full-parity percentage.

Public internet pairing, three-click region selection, headset media-key
mapping, shared-screen self-tests and surfaced web-search citations remain
unfinished. This build is not full feature parity with Interview Genie.
