//! Native (non-webview) audio playback for the fire alarm siren and the
//! trouble/supervisory beep.
//!
//! WebView2's autoplay policy can silently block `<audio>` playback inside
//! the webview. Playing through rodio/cpal instead runs entirely outside the
//! webview, so it isn't subject to that policy at all. The looping siren
//! runs on a dedicated background thread and is controlled with start/stop
//! messages so the underlying `cpal` stream (which isn't `Send` on every
//! platform) never has to leave the thread that created it.

use std::fs::{create_dir_all, OpenOptions};
use std::io::{Cursor, Write};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::OnceLock;
use std::time::Duration;

use rodio::{Decoder, OutputStream, Sink, Source};
use tauri::{AppHandle, Manager};

const FIRE_SIREN_BYTES: &[u8] = include_bytes!("../../public/alarm_sound.mp3");
const PANEL_BEEP_BYTES: &[u8] = include_bytes!("../../public/beep.mp3");

enum SirenMsg {
    Start(AppHandle),
    Stop,
}

fn siren_sender() -> &'static Sender<SirenMsg> {
    static SENDER: OnceLock<Sender<SirenMsg>> = OnceLock::new();
    SENDER.get_or_init(|| {
        let (tx, rx) = channel::<SirenMsg>();
        std::thread::spawn(move || siren_thread(rx));
        tx
    })
}

/// Mirrors `log_message` in lib.rs (same `logs/server.log` file, read back by
/// the `get_server_log` command) so a failed siren start is actually visible
/// to the user instead of only reaching a console nobody has open in a
/// packaged build.
fn log_to_file(app: &AppHandle, msg: &str) {
    eprintln!("[vision365] {msg}");
    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = create_dir_all(app_data.join("logs"));
        let log_path = app_data.join("logs").join("server.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = writeln!(f, "[vision365] {msg}");
        }
    }
}

fn siren_thread(rx: Receiver<SirenMsg>) {
    // Owned only by this thread — dropping stops playback immediately.
    let mut playing: Option<(OutputStream, Sink)> = None;

    while let Ok(msg) = rx.recv() {
        match msg {
            SirenMsg::Start(app) => {
                if playing.is_some() {
                    continue;
                }
                match start_looping_siren(&app) {
                    Ok(handle) => {
                        playing = Some(handle);
                        #[cfg(windows)]
                        crate::winaudio::unmute_and_max_current_process();
                    }
                    Err(e) => log_to_file(&app, &format!("siren: giving up after retries: {e}")),
                }
            }
            SirenMsg::Stop => {
                playing = None;
            }
        }
    }
}

fn try_start_looping_siren() -> Result<(OutputStream, Sink), String> {
    let (stream, handle) = OutputStream::try_default().map_err(|e| e.to_string())?;
    let sink = Sink::try_new(&handle).map_err(|e| e.to_string())?;
    let source = Decoder::new(Cursor::new(FIRE_SIREN_BYTES)).map_err(|e| e.to_string())?;
    sink.set_volume(1.0);
    sink.append(source.repeat_infinite());
    sink.play();
    Ok((stream, sink))
}

/// Acquiring the default output device can fail transiently (e.g. the audio
/// subsystem is still waking up after being idle, or another process briefly
/// holds it) — a single failed attempt here used to mean the fire siren
/// silently never sounded for that alarm, with nothing telling us why. Retry
/// generously before giving up: this runs on the dedicated siren thread, not
/// the Tauri command handler, so a few seconds of retrying here costs nothing
/// — `start_fire_siren` already returned to the caller as soon as the Start
/// message was queued.
const SIREN_START_ATTEMPTS: u32 = 12;
const SIREN_START_RETRY_DELAY_MS: u64 = 300;

fn start_looping_siren(app: &AppHandle) -> Result<(OutputStream, Sink), String> {
    let mut last_err = String::new();
    for attempt in 1..=SIREN_START_ATTEMPTS {
        if attempt > 1 {
            std::thread::sleep(Duration::from_millis(SIREN_START_RETRY_DELAY_MS));
        }
        match try_start_looping_siren() {
            Ok(handle) => {
                if attempt > 1 {
                    log_to_file(app, &format!("siren: started on attempt {attempt}/{SIREN_START_ATTEMPTS}"));
                }
                return Ok(handle);
            }
            Err(e) => {
                log_to_file(
                    app,
                    &format!("siren: start attempt {attempt}/{SIREN_START_ATTEMPTS} failed: {e}"),
                );
                last_err = e;
            }
        }
    }
    Err(last_err)
}

/// Starts the looping fire siren if it isn't already playing. Idempotent.
#[tauri::command]
pub fn start_fire_siren(app: AppHandle) -> Result<(), String> {
    siren_sender()
        .send(SirenMsg::Start(app))
        .map_err(|e| e.to_string())
}

/// Stops the looping fire siren. This is the only way to silence it besides
/// the physical/OS master volume — called from the Mute Siren button and on
/// Acknowledge.
#[tauri::command]
pub fn stop_fire_siren() -> Result<(), String> {
    siren_sender()
        .send(SirenMsg::Stop)
        .map_err(|e| e.to_string())
}

/// Plays the trouble/supervisory alert beep once, outside the webview.
/// Fire-and-forget: spawns a short-lived thread that exits once the (short)
/// clip finishes playing.
#[tauri::command]
pub fn play_panel_alert_beep() -> Result<(), String> {
    std::thread::Builder::new()
        .name("panel-alert-beep".into())
        .spawn(|| {
            let (_stream, handle) = match OutputStream::try_default() {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[vision365] beep: output stream failed: {e}");
                    return;
                }
            };
            let sink = match Sink::try_new(&handle) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("[vision365] beep: sink failed: {e}");
                    return;
                }
            };
            match Decoder::new(Cursor::new(PANEL_BEEP_BYTES)) {
                Ok(source) => {
                    sink.set_volume(1.0);
                    sink.append(source);
                    #[cfg(windows)]
                    crate::winaudio::unmute_and_max_current_process();
                    sink.sleep_until_end();
                }
                Err(e) => eprintln!("[vision365] beep: decode failed: {e}"),
            }
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}
