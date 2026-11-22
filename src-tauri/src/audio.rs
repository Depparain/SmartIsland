use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use windows::{
    core::{GUID, HRESULT, PCWSTR, Interface},
    Win32::{
        Media::Audio::{
            Endpoints::{IAudioEndpointVolume, IAudioMeterInformation},
            eCapture, eConsole, eCommunications, eMultimedia, eRender,
            DEVICE_STATE_ACTIVE, IMMDeviceEnumerator,
            MMDeviceEnumerator, ERole,
            IAudioSessionManager2, IAudioSessionControl2,
            ISimpleAudioVolume, AudioSessionStateExpired,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
            StructuredStorage::PropVariantToStringAlloc,
        },
    },
};

#[cfg(windows)]
#[windows::core::interface("f8679f50-850a-41cf-9c72-430f290290c8")]
pub unsafe trait IPolicyConfig: windows::core::IUnknown {
    pub unsafe fn Unused1(&self) -> HRESULT;
    pub unsafe fn Unused2(&self) -> HRESULT;
    pub unsafe fn Unused3(&self) -> HRESULT;
    pub unsafe fn Unused4(&self) -> HRESULT;
    pub unsafe fn Unused5(&self) -> HRESULT;
    pub unsafe fn Unused6(&self) -> HRESULT;
    pub unsafe fn Unused7(&self) -> HRESULT;
    pub unsafe fn Unused8(&self) -> HRESULT;
    pub unsafe fn GetPropertyValue(&self) -> HRESULT;
    pub unsafe fn SetPropertyValue(&self) -> HRESULT;
    pub unsafe fn SetDefaultEndpoint(&self, device_id: PCWSTR, role: ERole) -> HRESULT;
    pub unsafe fn SetEndpointVisibility(&self, device_id: PCWSTR, visible: i16) -> HRESULT;
}

#[cfg(windows)]
const CLSID_POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);


// PKEY_Device_FriendlyName: {a45c254e-df1c-4efd-8020-67d146a850e0}, 14
#[cfg(windows)]
const PKEY_DEVICE_FRIENDLYNAME: windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY =
    windows::Win32::UI::Shell::PropertiesSystem::PROPERTYKEY {
        fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0),
        pid: 14,
    };

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppAudioSession {
    pub id: String,
    pub pid: u32,
    pub name: String,
    pub volume: u32,
    pub is_muted: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AudioState {
    pub render_devices: Vec<AudioDevice>,
    pub capture_devices: Vec<AudioDevice>,
    pub app_sessions: Vec<AppAudioSession>,
    pub master_volume: u32,
    pub is_muted: bool,
    pub is_audio_active: bool,
    pub audio_peak: f32,
}

pub struct AudioManager {
    pub last_volume: Mutex<u32>,
}

impl AudioManager {
    pub fn new() -> Self {
        Self {
            last_volume: Mutex::new(70),
        }
    }
}

#[cfg(windows)]
unsafe fn query_devices(is_capture: bool) -> (Vec<AudioDevice>, String) {
    let mut devices = Vec::new();
    let mut default_id = String::new();

    let enumerator: Result<IMMDeviceEnumerator, _> =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
    let enumerator = match enumerator {
        Ok(e) => e,
        Err(_) => return (devices, default_id),
    };

    let data_flow = if is_capture { eCapture } else { eRender };

    // Get default
    if let Ok(def_dev) = enumerator.GetDefaultAudioEndpoint(data_flow, eConsole) {
        if let Ok(id) = def_dev.GetId() {
            default_id = id.to_string().unwrap_or_default();
        }
    }

    if let Ok(collection) = enumerator.EnumAudioEndpoints(data_flow, DEVICE_STATE_ACTIVE) {
        let count = collection.GetCount().unwrap_or(0);
        for i in 0..count {
            if let Ok(device) = collection.Item(i) {
                let id = device.GetId().map(|p| p.to_string().unwrap_or_default()).unwrap_or_default();
                let mut name = id.clone();

                if let Ok(props) = device.OpenPropertyStore(windows::Win32::System::Com::STGM_READ) {
                    if let Ok(prop_var) = props.GetValue(&PKEY_DEVICE_FRIENDLYNAME) {
                        if let Ok(pwstr) = PropVariantToStringAlloc(&prop_var) {
                            name = pwstr.to_string().unwrap_or(id.clone());
                        }
                    }
                }

                let is_default = id == default_id;
                devices.push(AudioDevice {
                    id,
                    name,
                    is_default,
                });
            }
        }
    }

    (devices, default_id)
}

#[cfg(windows)]
fn format_app_name(raw_name: &str) -> String {
    let lower = raw_name.to_lowercase();
    match lower.as_str() {
        "chrome" => "Google Chrome".to_string(),
        "msedge" => "Microsoft Edge".to_string(),
        "firefox" => "Firefox".to_string(),
        "spotify" => "Spotify".to_string(),
        "discord" => "Discord".to_string(),
        "telegram" => "Telegram".to_string(),
        "vlc" => "VLC Media Player".to_string(),
        "steam" | "steamwebhelper" => "Steam".to_string(),
        "code" => "VS Code".to_string(),
        "devenv" => "Visual Studio".to_string(),
        "obs64" | "obs32" => "OBS Studio".to_string(),
        "wmplayer" => "Windows Media Player".to_string(),
        "opera" => "Opera".to_string(),
        "brave" => "Brave".to_string(),
        _ => {
            let mut c = raw_name.chars();
            match c.next() {
                None => raw_name.to_string(),
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
            }
        }
    }
}

#[cfg(windows)]
fn get_process_name(pid: u32, session2: Option<&IAudioSessionControl2>) -> String {
    if pid == 0 {
        return "System Sounds".to_string();
    }
    // 1. Try OpenProcess & QueryFullProcessImageNameW
    unsafe {
        if let Ok(handle) = windows::Win32::System::Threading::OpenProcess(
            windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        ) {
            let mut name_buf = [0u16; 1024];
            let mut size = name_buf.len() as u32;
            let res = windows::Win32::System::Threading::QueryFullProcessImageNameW(
                handle,
                windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0),
                windows_core::PWSTR(name_buf.as_mut_ptr()),
                &mut size,
            );
            let _ = windows::Win32::Foundation::CloseHandle(handle);
            if res.is_ok() && size > 0 {
                let full_path = String::from_utf16_lossy(&name_buf[..size as usize]);
                if let Some(file_name) = std::path::Path::new(&full_path).file_stem().and_then(|s| s.to_str()) {
                    if !file_name.is_empty() {
                        return format_app_name(file_name);
                    }
                }
            }
        }
    }

    // 2. Try session identifier if OpenProcess was denied or returned empty
    if let Some(s2) = session2 {
        unsafe {
            if let Ok(id_pwstr) = s2.GetSessionIdentifier() {
                let id_str = id_pwstr.to_string().unwrap_or_default();
                let parts: Vec<&str> = id_str.split('\\').collect();
                if let Some(last_part) = parts.last() {
                    let exe_stem = last_part.split('%').next().unwrap_or(last_part);
                    let stem = exe_stem.trim_end_matches(".exe");
                    if !stem.is_empty() && stem.len() > 1 && !stem.starts_with('{') {
                        return format_app_name(stem);
                    }
                }
            }
        }
    }

    format!("App ({})", pid)
}

#[cfg(windows)]
unsafe fn query_app_sessions() -> Vec<AppAudioSession> {
    let mut sessions = Vec::new();
    let current_pid = std::process::id();

    let enumerator: Result<IMMDeviceEnumerator, _> =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
    let enumerator = match enumerator {
        Ok(e) => e,
        Err(_) => return sessions,
    };

    let mut checked_endpoints = Vec::new();
    for role in [eMultimedia, eConsole] {
        let dev = match enumerator.GetDefaultAudioEndpoint(eRender, role) {
            Ok(d) => d,
            Err(_) => continue,
        };

        if let Ok(id_pwstr) = dev.GetId() {
            let id_str = id_pwstr.to_string().unwrap_or_default();
            if checked_endpoints.contains(&id_str) {
                continue;
            }
            checked_endpoints.push(id_str);
        }

        let session_mgr: Result<IAudioSessionManager2, _> =
            dev.Activate(CLSCTX_ALL, None);
        let session_mgr = match session_mgr {
            Ok(m) => m,
            Err(_) => continue,
        };

        let session_enum = match session_mgr.GetSessionEnumerator() {
            Ok(e) => e,
            Err(_) => continue,
        };

        let count = session_enum.GetCount().unwrap_or(0);
        for i in 0..count {
            if let Ok(session) = session_enum.GetSession(i) {
                // Check state: skip expired sessions
                if let Ok(state) = session.GetState() {
                    if state == AudioSessionStateExpired {
                        continue;
                    }
                }

                let session2: Result<IAudioSessionControl2, _> = session.cast();
                let pid = if let Ok(ref s2) = session2 {
                    s2.GetProcessId().unwrap_or(0)
                } else {
                    0
                };

                // Filter out Smart Island itself
                if pid != 0 && pid == current_pid {
                    continue;
                }

                // If already recorded this PID, skip duplicates
                if pid != 0 && sessions.iter().any(|s: &AppAudioSession| s.pid == pid) {
                    continue;
                }

                let name = if pid == 0 {
                    "System Sounds".to_string()
                } else {
                    get_process_name(pid, session2.as_ref().ok())
                };

                let volume_ctl: Result<ISimpleAudioVolume, _> = session.cast();
                if let Ok(vol) = volume_ctl {
                    let scalar = vol.GetMasterVolume().unwrap_or(1.0);
                    let is_muted = vol.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                    let pct = (scalar * 100.0).round() as u32;

                    sessions.push(AppAudioSession {
                        id: format!("{}:{}", pid, name),
                        pid,
                        name,
                        volume: pct,
                        is_muted,
                    });
                }
            }
        }
    }

    // Sort: apps first alphabetically, System Sounds last
    sessions.sort_by(|a, b| {
        if a.pid == 0 && b.pid != 0 {
            std::cmp::Ordering::Greater
        } else if a.pid != 0 && b.pid == 0 {
            std::cmp::Ordering::Less
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    sessions
}

#[cfg(windows)]
unsafe fn get_master_volume_info() -> (u32, bool) {
    let enumerator: Result<IMMDeviceEnumerator, _> =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
    let enumerator = match enumerator {
        Ok(e) => e,
        Err(_) => return (70, false),
    };

    for role in [eMultimedia, eConsole] {
        if let Ok(default_render) = enumerator.GetDefaultAudioEndpoint(eRender, role) {
            if let Ok(endpoint_volume) =
                default_render.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            {
                let vol_scalar = endpoint_volume.GetMasterVolumeLevelScalar().unwrap_or(0.7);
                let muted = endpoint_volume.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                let pct = (vol_scalar * 100.0).round() as u32;
                return (pct, muted);
            }
        }
    }

    (70, false)
}

#[cfg(windows)]
pub unsafe fn get_master_audio_peak() -> f32 {
    let enumerator: Result<IMMDeviceEnumerator, _> =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
    let enumerator = match enumerator {
        Ok(e) => e,
        Err(_) => return 0.0,
    };

    let mut max_peak: f32 = 0.0;

    // 1. Check eMultimedia role (used by browsers & media apps)
    if let Ok(dev) = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia) {
        if let Ok(meter) = dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) {
            if let Ok(peak) = meter.GetPeakValue() {
                if peak > max_peak {
                    max_peak = peak;
                }
            }
        }
    }

    // 2. Check eConsole role (used by games & system sounds)
    if max_peak <= 0.0001 {
        if let Ok(dev) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
            if let Ok(meter) = dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) {
                if let Ok(peak) = meter.GetPeakValue() {
                    if peak > max_peak {
                        max_peak = peak;
                    }
                }
            }
        }
    }

    // 3. Fallback: check all active endpoints (e.g. secondary headphones/DAC)
    if max_peak <= 0.0001 {
        if let Ok(collection) = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) {
            let count = collection.GetCount().unwrap_or(0);
            for i in 0..count {
                if let Ok(dev) = collection.Item(i) {
                    if let Ok(meter) = dev.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) {
                        if let Ok(peak) = meter.GetPeakValue() {
                            if peak > max_peak {
                                max_peak = peak;
                                if max_peak > 0.01 {
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    max_peak
}

#[tauri::command]
pub async fn get_audio_state() -> Result<AudioState, String> {
    let res = tokio::time::timeout(
        std::time::Duration::from_millis(600),
        tokio::task::spawn_blocking(|| {
            #[cfg(windows)]
            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
                let (render_devices, _) = query_devices(false);
                let (capture_devices, _) = query_devices(true);
                let app_sessions = query_app_sessions();
                let (master_volume, is_muted) = get_master_volume_info();
                let peak = get_master_audio_peak();
                let is_audio_active = peak > 0.001;
                if need_uninit {
                    CoUninitialize();
                }

                AudioState {
                    render_devices,
                    capture_devices,
                    app_sessions,
                    master_volume,
                    is_muted,
                    is_audio_active,
                    audio_peak: peak,
                }
            }
            #[cfg(not(windows))]
            AudioState::default()
        }),
    )
    .await;

    match res {
        Ok(Ok(state)) => Ok(state),
        _ => Ok(AudioState::default()),
    }
}

#[tauri::command]
pub async fn audio_set_default_device(device_id: String, _is_capture: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
            let policy: Result<IPolicyConfig, _> = CoCreateInstance(&CLSID_POLICY_CONFIG_CLIENT, None, CLSCTX_ALL);
            if let Ok(p) = policy {
                let id_wide: Vec<u16> = device_id.encode_utf16().chain(std::iter::once(0)).collect();
                let pcwstr = PCWSTR(id_wide.as_ptr());
                let _ = p.SetDefaultEndpoint(pcwstr, eConsole);
                let _ = p.SetDefaultEndpoint(pcwstr, eMultimedia);
                let _ = p.SetDefaultEndpoint(pcwstr, eCommunications);
            }
            if need_uninit {
                CoUninitialize();
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn audio_set_master_volume(volume: u32) -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
            let enumerator: Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            if let Ok(enumerator) = enumerator {
                for role in [eMultimedia, eConsole] {
                    if let Ok(default_render) = enumerator.GetDefaultAudioEndpoint(eRender, role) {
                        if let Ok(endpoint_volume) = default_render.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                            let scalar = (volume.min(100) as f32) / 100.0;
                            let _ = endpoint_volume.SetMasterVolumeLevelScalar(scalar, std::ptr::null());
                            break;
                        }
                    }
                }
            }
            if need_uninit {
                CoUninitialize();
            }
        }
    })
    .await;
    Ok(())
}

#[tauri::command]
pub async fn audio_set_mute(muted: bool) -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
            let enumerator: Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            if let Ok(enumerator) = enumerator {
                for role in [eMultimedia, eConsole] {
                    if let Ok(default_render) = enumerator.GetDefaultAudioEndpoint(eRender, role) {
                        if let Ok(endpoint_volume) = default_render.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                            let _ = endpoint_volume.SetMute(muted, std::ptr::null());
                            break;
                        }
                    }
                }
            }
            if need_uninit {
                CoUninitialize();
            }
        }
    })
    .await;
    Ok(())
}

#[tauri::command]
pub async fn audio_get_app_sessions() -> Result<Vec<AppAudioSession>, String> {
    let res = tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
            let sessions = query_app_sessions();
            if need_uninit {
                CoUninitialize();
            }
            sessions
        }
        #[cfg(not(windows))]
        Vec::new()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(res)
}

#[tauri::command]
pub async fn audio_set_app_volume(pid: u32, volume: u32) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
            let enumerator: Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            if let Ok(enumerator) = enumerator {
                let mut checked_endpoints = Vec::new();
                for role in [eMultimedia, eConsole] {
                    if let Ok(dev) = enumerator.GetDefaultAudioEndpoint(eRender, role) {
                        if let Ok(id_pwstr) = dev.GetId() {
                            let id_str = id_pwstr.to_string().unwrap_or_default();
                            if checked_endpoints.contains(&id_str) {
                                continue;
                            }
                            checked_endpoints.push(id_str);
                        }
                        if let Ok(session_mgr) = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                            if let Ok(session_enum) = session_mgr.GetSessionEnumerator() {
                                let count = session_enum.GetCount().unwrap_or(0);
                                for i in 0..count {
                                    if let Ok(session) = session_enum.GetSession(i) {
                                        let session2: Result<IAudioSessionControl2, _> = session.cast();
                                        let sess_pid = session2.map(|s| s.GetProcessId().unwrap_or(0)).unwrap_or(0);
                                        if sess_pid == pid {
                                            if let Ok(vol) = session.cast::<ISimpleAudioVolume>() {
                                                let scalar = (volume.min(100) as f32) / 100.0;
                                                let _ = vol.SetMasterVolume(scalar, std::ptr::null());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if need_uninit {
                CoUninitialize();
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn audio_set_app_mute(pid: u32, muted: bool) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
            let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
            let enumerator: Result<IMMDeviceEnumerator, _> =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL);
            if let Ok(enumerator) = enumerator {
                let mut checked_endpoints = Vec::new();
                for role in [eMultimedia, eConsole] {
                    if let Ok(dev) = enumerator.GetDefaultAudioEndpoint(eRender, role) {
                        if let Ok(id_pwstr) = dev.GetId() {
                            let id_str = id_pwstr.to_string().unwrap_or_default();
                            if checked_endpoints.contains(&id_str) {
                                continue;
                            }
                            checked_endpoints.push(id_str);
                        }
                        if let Ok(session_mgr) = dev.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) {
                            if let Ok(session_enum) = session_mgr.GetSessionEnumerator() {
                                let count = session_enum.GetCount().unwrap_or(0);
                                for i in 0..count {
                                    if let Ok(session) = session_enum.GetSession(i) {
                                        let session2: Result<IAudioSessionControl2, _> = session.cast();
                                        let sess_pid = session2.map(|s| s.GetProcessId().unwrap_or(0)).unwrap_or(0);
                                        if sess_pid == pid {
                                            if let Ok(vol) = session.cast::<ISimpleAudioVolume>() {
                                                let _ = vol.SetMute(muted, std::ptr::null());
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if need_uninit {
                CoUninitialize();
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn start_audio_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(150));
        let mut last_active = false;
        let mut silent_ticks = 10u32;
        let mut tick_counter = 0u32;

        loop {
            interval.tick().await;
            tick_counter = tick_counter.wrapping_add(1);

            let maybe_peak = tokio::time::timeout(
                std::time::Duration::from_millis(500),
                tokio::task::spawn_blocking(|| {
                    #[cfg(windows)]
                    unsafe {
                        let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                        let need_uninit = hr == windows::core::HRESULT(0) || hr == windows::core::HRESULT(1);
                        let peak = get_master_audio_peak();
                        if need_uninit {
                            CoUninitialize();
                        }
                        peak
                    }
                    #[cfg(not(windows))]
                    0.0f32
                }),
            )
            .await;

            if let Ok(Ok(peak)) = maybe_peak {
                let is_active = peak > 0.001;
                if is_active {
                    silent_ticks = 0;
                } else {
                    silent_ticks = silent_ticks.saturating_add(1);
                }

                // Smooth: active if peak > 0.001 OR silent for less than 4 ticks (600ms)
                let smoothed_active = is_active || (silent_ticks < 4);

                let should_emit = smoothed_active != last_active || (tick_counter % 4 == 0);

                if should_emit {
                    if smoothed_active != last_active {
                        crate::window_ctl::log_runtime(&format!(
                            "[AUDIO-SENSOR] Sound changed: is_active={}, peak={:.4}",
                            smoothed_active, peak
                        ));
                    }
                    last_active = smoothed_active;

                    let _ = app.emit("audio-activity-changed", serde_json::json!({
                        "isAudioActive": smoothed_active,
                        "audioPeak": peak,
                    }));
                }
            }
        }
    });
}
