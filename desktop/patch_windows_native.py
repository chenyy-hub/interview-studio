"""Adapt the pinned Windows loopback backend to the common fallible API."""
from pathlib import Path
import hashlib
import sys

EXPECTED = 'bc2dca21674080fd3ec152b2f5f1ea60132dc165d9b6d0623eba475efacbbe0c'


def patch(root):
    target = root / 'native-module/src/speaker/windows.rs'
    raw = target.read_bytes()
    # Git checkout may use CRLF on Windows; normalize before checking provenance.
    source = raw.decode().replace('\r\n', '\n')
    if hashlib.sha256(source.encode()).hexdigest() != EXPECTED:
        raise RuntimeError('Windows audio source differs from the reviewed pinned upstream')
    def replace(old, new):
        nonlocal source
        if source.count(old) != 1:
            raise RuntimeError('Unexpected Windows audio code shape')
        source = source.replace(old, new, 1)
    replace('struct WakerState {', '''// COM apartments belong to threads. Balance only our successful init call;
// an existing STA apartment can enumerate devices without being reinitialized.
struct ComGuard(bool);
impl ComGuard {
    fn initialize() -> Result<Self> {
        let result = wasapi::initialize_mta();
        if result.is_ok() {
            Ok(Self(true))
        } else if result.0 as u32 == 0x80010106 { // RPC_E_CHANGED_MODE
            Ok(Self(false))
        } else {
            Err(anyhow::anyhow!("COM initialization failed: {:?}", result))
        }
    }
}
impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.0 { unsafe { windows::Win32::System::Com::CoUninitialize(); } }
    }
}

struct WakerState {''')
    replace('pub fn list_output_devices() -> Result<Vec<(String, String)>> {', 'pub fn list_output_devices() -> Result<Vec<(String, String)>> {\n    let _com = ComGuard::initialize()?;')
    replace('pub fn stream(self) -> SpeakerStream {', 'pub fn stream(self) -> Result<SpeakerStream> {')
    replace('''                error!("Audio initialization failed: {}", e);
                44100''', '''                let _ = capture_thread.join();
                return Err(e);''')
    replace('''                error!("Audio initialization timeout");
                44100''', '''                if let Ok(mut state) = waker_state.lock() { state.shutdown = true; }
                // Detach a still-initializing thread rather than block the caller.
                // Once initialized, it observes shutdown before reading audio.
                return Err(anyhow::anyhow!("Windows loopback initialization timed out"));''')
    replace('''        SpeakerStream {
            consumer:''', '''        Ok(SpeakerStream {
            consumer:''')
    replace('''            data_ready,
        }
    }

    fn capture_audio_loop''', '''            data_ready,
        })
    }

    fn capture_audio_loop''')
    replace('''        let init_result = (|| -> Result<_> {''', '''        let _com = match ComGuard::initialize() {
            Ok(guard) => guard,
            Err(error) => { let _ = init_tx.send(Err(error)); return Ok(()); }
        };
        let init_result = (|| -> Result<_> {''')
    replace('''.map_err(|e| anyhow::anyhow!("{}", e))
                        .expect("No default render device"),''', '''.map_err(|e| anyhow::anyhow!("{}", e))?,''')
    replace('''                    if h_event.wait_for_event(3000).is_err() {
                        error!("Timeout error, stopping capture");
                        break;
                    }''', '''                    if h_event.wait_for_event(100).is_err() {
                        // An idle playback device need not emit packets. Keep
                        // waiting and check shutdown instead of ending capture.
                        thread::sleep(Duration::from_millis(10));
                        continue;
                    }''')
    target.write_text(source, encoding='utf-8', newline='\n')
    print('Windows loopback patched: Result API, COM lifetime, honest initialization failure and idle waiting')


if __name__ == '__main__':
    patch(Path(sys.argv[1]).resolve())
