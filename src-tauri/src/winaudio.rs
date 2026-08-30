//! Windows-only: force this process's Core Audio session to unmuted/100% so
//! the fire siren cannot be silenced by a stale per-app Volume Mixer setting.
//! Best-effort only — this cannot override the OS master volume or a
//! physical/hardware mute, nothing running in software can.

use windows::core::Interface;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// Un-mutes and maxes out this process's entry in the Windows Volume Mixer.
/// Safe to call repeatedly; logs and gives up quietly on any failure (e.g. no
/// audio device present) rather than affecting siren playback.
pub fn unmute_and_max_current_process() {
    unsafe {
        let co_initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();

        if let Err(e) = unmute_and_max_current_process_inner() {
            eprintln!("[vision365] winaudio: could not force-unmute session: {e:?}");
        }

        if co_initialized {
            CoUninitialize();
        }
    }
}

unsafe fn unmute_and_max_current_process_inner() -> windows::core::Result<()> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
    let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
    let session_manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
    let session_enumerator = session_manager.GetSessionEnumerator()?;

    let count = session_enumerator.GetCount()?;
    let current_pid = std::process::id();

    for i in 0..count {
        let session_control = session_enumerator.GetSession(i)?;
        let session_control2: IAudioSessionControl2 = session_control.cast()?;

        if session_control2.GetProcessId().unwrap_or(0) != current_pid {
            continue;
        }

        let simple_volume: ISimpleAudioVolume = session_control2.cast()?;
        simple_volume.SetMute(false, std::ptr::null())?;
        simple_volume.SetMasterVolume(1.0, std::ptr::null())?;
    }

    Ok(())
}
