use std::sync::Mutex;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

#[cfg(windows)]
use windows::Win32::UI::Shell::{
    SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN,
};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    pub id: String,
    pub name: String,
    pub is_primary: bool,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
}

pub struct WindowManager {
    pub target_monitor_id: Mutex<String>,
    pub is_hidden_by_fullscreen: Mutex<bool>,
}

impl WindowManager {
    pub fn new() -> Self {
        Self {
            target_monitor_id: Mutex::new("primary".to_string()),
            is_hidden_by_fullscreen: Mutex::new(false),
        }
    }
}

/// Reposition the window horizontally centered at the top of the target monitor
pub fn center_window_top(window: &WebviewWindow, width: u32, height: u32, monitor_id: &str) {
    let monitors = window.available_monitors().unwrap_or_default();
    println!("[SMART-ISLAND] Found {} monitors", monitors.len());

    let target_monitor = if monitor_id == "primary" {
        window.primary_monitor().ok().flatten().or_else(|| monitors.first().cloned())
    } else {
        monitors.iter().find(|m| {
            m.name().map(|n| n.as_str() == monitor_id).unwrap_or(false)
        }).cloned()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| monitors.first().cloned())
    };

    let (center_x, top_y, physical_width, physical_height) = if let Some(m) = target_monitor {
        let mon_pos = m.position();
        let mon_size = m.size();
        let scale = m.scale_factor();
        println!("[SMART-ISLAND] Target monitor: pos=({},{}), size=({}x{}), scale={}", mon_pos.x, mon_pos.y, mon_size.width, mon_size.height, scale);

        let p_width = (width as f64 * scale).round() as i32;
        let p_height = (height as f64 * scale).round() as i32;

        let cx = mon_pos.x + (mon_size.width as i32 - p_width) / 2;
        let cy = mon_pos.y; // 0px margin: flush with monitor top bezel (monolithic notch)
        (cx, cy, p_width as u32, p_height as u32)
    } else {
        println!("[SMART-ISLAND] No monitor found, using fallback 1920x1080 bounds");
        let cx = (1920 - width as i32) / 2;
        let cy = 0;
        (cx, cy, width, height)
    };

    println!("[SMART-ISLAND] Setting window size ({}x{}) and pos ({},{})", physical_width, physical_height, center_x, top_y);
    log_runtime(&format!("[WINDOW] set_size: {}x{}, pos: {},{}", physical_width, physical_height, center_x, top_y));
    let _ = window.set_size(PhysicalSize::new(physical_width, physical_height));
    let _ = window.set_position(PhysicalPosition::new(center_x, top_y));
    let _ = window.set_always_on_top(true);
    let _ = window.set_shadow(false);

    #[cfg(windows)]
    unsafe {
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute,
            DWMWA_WINDOW_CORNER_PREFERENCE, DWMWA_BORDER_COLOR,
            DWMWCP_DONOTROUND,
        };
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetWindowLongW, GWL_EXSTYLE,
            WS_EX_TOOLWINDOW,
        };
        if let Ok(hwnd) = window.hwnd() {
            let hwnd = windows::Win32::Foundation::HWND(hwnd.0 as _);
            let corner_pref = DWMWCP_DONOTROUND.0;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &corner_pref as *const _ as _,
                std::mem::size_of_val(&corner_pref) as u32,
            );
            let border_color: u32 = 0xFFFFFFFE; // DWMWA_COLOR_NONE
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_BORDER_COLOR,
                &border_color as *const _ as _,
                std::mem::size_of_val(&border_color) as u32,
            );

            // Force WS_EX_TOOLWINDOW to hide from taskbar and Alt-Tab
            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            SetWindowLongW(hwnd, GWL_EXSTYLE, (ex_style | WS_EX_TOOLWINDOW.0) as i32);
        }
    }

    let _ = window.show();

    println!("[SMART-ISLAND] Window HWND: {:?}, is_visible: {:?}", window.hwnd(), window.is_visible());
}

/// Enumerate all connected monitors
#[tauri::command]
pub fn get_monitors(window: WebviewWindow) -> Result<Vec<MonitorInfo>, String> {
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let primary = window.primary_monitor().ok().flatten();

    let mut result = Vec::new();
    for (i, m) in monitors.into_iter().enumerate() {
        let name = m.name().map(|s| s.to_string()).unwrap_or_else(|| format!("Display {}", i + 1));
        let is_primary = primary
            .as_ref()
            .and_then(|p| p.name().map(|n| n.as_str() == name.as_str()))
            .unwrap_or(false);
        let size = m.size();

        result.push(MonitorInfo {
            id: name.clone(),
            name,
            is_primary,
            width: size.width,
            height: size.height,
            scale_factor: m.scale_factor(),
        });
    }

    Ok(result)
}

/// Adjust physical window size and center horizontally (AC 0.1, AC 0.2, AC 0.3)
#[tauri::command]
pub fn set_window_size(app: AppHandle, width: u32, height: u32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let state = app.state::<WindowManager>();
        let target_id = state.target_monitor_id.lock().unwrap().clone();
        center_window_top(&window, width, height, &target_id);
    }
    Ok(())
}

/// Set target display monitor
#[tauri::command]
pub fn set_target_monitor(app: AppHandle, monitor_id: String) -> Result<(), String> {
    let state = app.state::<WindowManager>();
    *state.target_monitor_id.lock().unwrap() = monitor_id.clone();

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(size) = window.outer_size() {
            center_window_top(&window, size.width, size.height, &monitor_id);
        }
    }
    Ok(())
}

pub fn log_runtime(msg: &str) {
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        let dir = std::path::PathBuf::from(local_app_data).join("com.smartisland.app");
        let _ = std::fs::create_dir_all(&dir);
        let log_path = dir.join("island.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            use std::io::Write;
            let _ = writeln!(f, "{}", msg);
        }
    }
}

#[cfg(windows)]
unsafe fn is_active_fullscreen_game(our_hwnd: Option<windows::Win32::Foundation::HWND>) -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect,
        GetWindowLongW, GetClassNameW, GetWindowThreadProcessId,
        GWL_STYLE, WS_CAPTION, WS_MAXIMIZE,
    };
    use windows::Win32::Foundation::RECT;

    let fg = GetForegroundWindow();
    if fg.0.is_null() {
        return false;
    }

    if fg == GetDesktopWindow() || fg == GetShellWindow() {
        return false;
    }

    if let Some(ours) = our_hwnd {
        if fg == ours {
            return false;
        }
    }

    // Filter out Desktop / Shell class names (Progman, WorkerW, Shell_TrayWnd, Shell_SecondaryTrayWnd)
    let mut class_buf = [0u16; 64];
    let len = GetClassNameW(fg, &mut class_buf);
    if len > 0 {
        let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
        if class_name == "WorkerW" || class_name == "Progman" || class_name.starts_with("Shell_") {
            return false;
        }
    }

    // Check foreground process image name to never hide for common productivity tools / wallpapers
    let mut pid = 0u32;
    GetWindowThreadProcessId(fg, Some(&mut pid));
    if pid > 0 {
        if let Ok(handle) = windows::Win32::System::Threading::OpenProcess(
            windows::Win32::System::Threading::PROCESS_QUERY_LIMITED_INFORMATION,
            false,
            pid,
        ) {
            let mut name_buf = [0u16; 260];
            let mut size = name_buf.len() as u32;
            if windows::Win32::System::Threading::QueryFullProcessImageNameW(
                handle,
                windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0),
                windows_core::PWSTR(name_buf.as_mut_ptr()),
                &mut size,
            ).is_ok() {
                let proc_path = String::from_utf16_lossy(&name_buf[..size as usize]).to_lowercase();
                if proc_path.ends_with("explorer.exe")
                    || proc_path.ends_with("wallpaper64.exe")
                    || proc_path.ends_with("wallpaper32.exe")
                    || proc_path.ends_with("chrome.exe")
                    || proc_path.ends_with("msedge.exe")
                    || proc_path.ends_with("firefox.exe")
                    || proc_path.ends_with("code.exe")
                    || proc_path.ends_with("antigravity.exe")
                    || proc_path.ends_with("discord.exe")
                    || proc_path.ends_with("telegram.exe")
                    || proc_path.ends_with("spotify.exe")
                    || proc_path.ends_with("smart-island.exe")
                {
                    let _ = windows::Win32::Foundation::CloseHandle(handle);
                    return false;
                }
            }
            let _ = windows::Win32::Foundation::CloseHandle(handle);
        }
    }

    // Check style: normal maximized windows (browsers, IDEs, telegram, etc.) have WS_MAXIMIZE
    let style = GetWindowLongW(fg, GWL_STYLE) as u32;
    if (style & WS_MAXIMIZE.0) != 0 {
        return false;
    }
    if (style & WS_CAPTION.0) == WS_CAPTION.0 {
        return false;
    }

    if let Ok(state) = SHQueryUserNotificationState() {
        if state != QUNS_RUNNING_D3D_FULL_SCREEN {
            return false;
        }
    } else {
        return false;
    }

    let mut rect = RECT::default();
    if GetWindowRect(fg, &mut rect).is_ok() {
        let width = rect.right - rect.left;
        let height = rect.bottom - rect.top;
        // True fullscreen games cover the entire monitor, including where the taskbar normally sits
        if width >= 1910 && height >= 1070 && rect.left <= 5 && rect.top <= 5 {
            return true;
        }
    }

    false
}

/// Periodic check for D3D fullscreen apps / games (AC 0.4)
pub fn start_fullscreen_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(1000));
        loop {
            interval.tick().await;

            #[cfg(windows)]
            {
                let our_hwnd_val: Option<isize> = if let Some(window) = app.get_webview_window("main") {
                    window.hwnd().ok().map(|h| h.0 as isize)
                } else {
                    None
                };

                let is_fullscreen = tokio::task::spawn_blocking(move || unsafe {
                    let hwnd = our_hwnd_val.map(|h| windows::Win32::Foundation::HWND(h as _));
                    is_active_fullscreen_game(hwnd)
                })
                .await
                .unwrap_or(false);

                if let Some(window) = app.get_webview_window("main") {
                    let win_mgr = app.state::<WindowManager>();
                    let mut hidden = win_mgr.is_hidden_by_fullscreen.lock().unwrap();

                    if is_fullscreen && !*hidden {
                        println!("[SMART-ISLAND] Fullscreen game active, hiding island window");
                        log_runtime("[FULLSCREEN] Fullscreen game active, hiding island window");
                        let _ = window.hide();
                        *hidden = true;
                    } else if !is_fullscreen && *hidden {
                        println!("[SMART-ISLAND] Fullscreen game exited, restoring island window");
                        log_runtime("[FULLSCREEN] Fullscreen game exited, restoring island window");
                        let _ = window.show();
                        *hidden = false;
                    }
                }
            }
        }
    });
}
