import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
PRODUCT = "InterviewStudio"
VERSION = "0.6.0"

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise RuntimeError("Unexpected upstream code shape: " + old[:80])
    return text.replace(old, new, 1)

def runtime_payload(read):
    package = json.loads(read('package.json'))
    if package['version'] != '3.4.0':
        raise RuntimeError('This adapter targets the Pika 3.4.0 release only')
    package.update(name='interview-studio', version=VERSION, main='desktop/bootstrap.cjs', productName=PRODUCT)
    additions = {'package.json': json.dumps(package, ensure_ascii=False, indent=2).encode()}
    for filename in ['bootstrap.cjs','credential-session.cjs','local-vault.cjs','service-readiness.cjs','audio-devices.cjs','native.cjs','answer-engine.cjs','context-index.cjs','fast-stream.cjs','privacy-controller.cjs','index.html','renderer.js','studio.css','remote.html']:
        additions['desktop/' + filename] = (ROOT / 'desktop' / filename).read_bytes()
    original_preload = read('dist-electron/electron/preload.js')
    additions['desktop/preload.cjs'] = (original_preload + '\n' + (ROOT / 'desktop/preload-extra.cjs').read_text()).encode()
    window = read('dist-electron/electron/helpers/WindowHelper.js')
    old_preload = 'node_path_1.default.join(__dirname, "../preload.js")'
    if window.count(old_preload) != 2:
        raise RuntimeError('Unexpected preload configuration')
    window = window.replace(old_preload, 'node_path_1.default.join(electron_1.app.getAppPath(), "desktop/preload.cjs")')
    window = replace_once(window, 'this.launcherWindow.loadURL(`${startUrl}?window=launcher`)', 'this.launcherWindow.loadURL(require("node:url").pathToFileURL(node_path_1.default.join(electron_1.app.getAppPath(), "desktop/index.html")).href)')
    window = replace_once(window, "this.overlayWindow.on('close', (e) => {", "this.overlayWindow.on('close', (e) => {\n                if (this.appState.isQuitting()) return;")
    additions['dist-electron/electron/helpers/WindowHelper.js'] = window.encode()
    main = read('dist-electron/electron/main.js')
    main = replace_once(main, "if (!(await (0, logging_1.ensureMacMicrophoneAccess)('meeting start'))) {", "this.studioCaptureMicrophone = metadata?.audio?.captureMicrophone === true;\n        if (this.studioCaptureMicrophone && !(await (0, logging_1.ensureMacMicrophoneAccess)('meeting start'))) {")
    for call in ['this.microphoneCapture?.start();', 'this.googleSTT_User?.start();']:
        # The official 3.4.0 binary contains a second recovery branch; a clean
        # build of the pinned 3.4.0 source contains the meeting-start branch.
        if main.count(call) not in (1, 2):
            raise RuntimeError('Unexpected microphone start paths')
        main = main.replace(call, 'if (this.studioCaptureMicrophone) ' + call)
    additions['dist-electron/electron/main.js'] = main.encode()
    mic = read('dist-electron/electron/audio/MicrophoneCapture.js')
    mic = replace_once(mic, "console.log('[MicrophoneCapture] Creating native monitor (Eager Init)...');", "console.log('[MicrophoneCapture] Native microphone will open only when explicitly started');")
    mic = mic.replace('this.monitor = new RustMicCapture(this.deviceId);', 'this.monitor = null; // Native microphone is deferred to start().', 1)
    additions['dist-electron/electron/audio/MicrophoneCapture.js'] = mic.encode()
    system_audio = read('dist-electron/electron/audio/SystemAudioCapture.js')
    if not 3 <= system_audio.count('get_sample_rate') <= 12:
        raise RuntimeError('Unexpected native sample-rate accessor')
    additions['dist-electron/electron/audio/SystemAudioCapture.js'] = system_audio.replace('get_sample_rate', 'getSampleRate').encode()
    lifecycle = read('dist-electron/electron/lib/lifecycle.js')
    lifecycle = replace_once(lifecycle, 'electron_1.app.setName("Pika")', 'electron_1.app.setName("Interview Studio")')
    # The upstream async before-quit cleanup can leave a windowless process
    # holding Chromium's singleton lock. Exit only after agent cleanup and
    # credential scrubbing above have completed, and release audio first.
    lifecycle = replace_once(lifecycle, 'quitCleanupDone = true;\n                electron_1.app.quit();', '''quitCleanupDone = true;
            for (const resource of [appState.systemAudioCapture, appState.microphoneCapture, appState.googleSTT, appState.googleSTT_User]) {
                try { resource?.stop(); } catch {}
            }
            electron_1.app.exit(0);''')
    additions['dist-electron/electron/lib/lifecycle.js'] = lifecycle.encode()
    config_paths = read('dist-electron/electron/services/configPaths.js')
    if config_paths.count("'pika'") != 2:
        raise RuntimeError('Unexpected upstream credential paths')
    additions['dist-electron/electron/services/configPaths.js'] = config_paths.replace("'pika'", "'interview-studio'").encode()
    updater = read('dist-electron/electron/lib/auto-updater.js')
    updater = updater.replace('autoUpdater.autoDownload = true', 'autoUpdater.autoDownload = false').replace('autoUpdater.autoInstallOnAppQuit = true', 'autoUpdater.autoInstallOnAppQuit = false')
    additions['dist-electron/electron/lib/auto-updater.js'] = updater.encode()
    additions['desktop/LICENSE'] = (ROOT / 'LICENSE').read_bytes()
    additions['desktop/UPSTREAM.txt'] = b'Pika 3.4.0, https://github.com/royisme/pikabaka, AGPL-3.0-only.\nInterview Studio local development extension.\n'

    return additions
