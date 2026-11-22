#![allow(dead_code)]
#![allow(non_snake_case)]

mod audio;
mod docker;
mod media;
mod notifications;
mod vpn;
mod window_ctl;

use std::fs;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_tabs_order", alias = "tabs_order")]
    pub tabs_order: Vec<String>,
    #[serde(default = "default_enabled_tabs", alias = "enabled_tabs")]
    pub enabled_tabs: std::collections::HashMap<String, bool>,
    #[serde(default = "default_selected_monitor", alias = "selected_monitor")]
    pub selected_monitor: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default = "default_collapse_timeout", alias = "collapse_timeout_seconds", alias = "collapseTimeoutSeconds", alias = "collapseTimeoutMinutes")]
    pub collapse_timeout_seconds: u32,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default, alias = "vpn_uri_key")]
    pub vpn_uri_key: Option<String>,
    #[serde(default, alias = "vpn_mode")]
    pub vpn_mode: Option<String>,
}

fn default_theme() -> String {
    "auto".to_string()
}

fn default_collapse_timeout() -> u32 {
    300
}

fn default_tabs_order() -> Vec<String> {
    vec![
        "media".into(),
        "audio".into(),
        "notifications".into(),
        "docker".into(),
        "vpn".into(),
        "settings".into(),
    ]
}

fn default_enabled_tabs() -> std::collections::HashMap<String, bool> {
    let mut map = std::collections::HashMap::new();
    map.insert("media".into(), true);
    map.insert("audio".into(), true);
    map.insert("notifications".into(), true);
    map.insert("docker".into(), true);
    map.insert("vpn".into(), true);
    map.insert("settings".into(), true);
    map
}

fn default_selected_monitor() -> String {
    "primary".into()
}

fn default_language() -> String {
    "ru".into()
}



#[tauri::command]
fn frontend_log(message: String) {
    println!("[FRONTEND] {}", message);
    window_ctl::log_runtime(&format!("[FRONTEND] {}", message));
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") {
            if let Ok(_val) = key.get_value::<String, _>("SmartIsland") {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[tauri::command]
fn set_autostart(enable: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok((key, _)) = hkcu.create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") {
            if enable {
                if let Ok(exe_path) = std::env::current_exe() {
                    let _ = key.set_value("SmartIsland", &exe_path.to_string_lossy().to_string());
                }
            } else {
                let _ = key.delete_value("SmartIsland");
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn save_settings(
    app: AppHandle,
    tabs_order: Vec<String>,
    enabled_tabs: std::collections::HashMap<String, bool>,
    selected_monitor: String,
    language: String,
    autostart: bool,
    collapse_timeout_seconds: Option<u32>,
    collapse_timeout_minutes: Option<u32>,
    theme: Option<String>,
    vpn_uri_key: Option<String>,
    vpn_mode: Option<String>,
) -> Result<(), String> {
    let timeout_sec = collapse_timeout_seconds
        .or_else(|| collapse_timeout_minutes.map(|m| m * 60))
        .unwrap_or(300);

    let settings = AppSettings {
        tabs_order,
        enabled_tabs,
        selected_monitor,
        language,
        autostart,
        collapse_timeout_seconds: timeout_sec,
        theme: theme.unwrap_or_else(default_theme),
        vpn_uri_key,
        vpn_mode,
    };

    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = fs::create_dir_all(&app_dir);
        let settings_path = app_dir.join("settings.json");
        let _ = fs::write(settings_path, serde_json::to_string_pretty(&settings).unwrap_or_default());
    }

    Ok(())
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<AppSettings>, String> {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let settings_path = app_dir.join("settings.json");
        if settings_path.exists() {
            if let Ok(content) = fs::read_to_string(settings_path) {
                if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                    return Ok(Some(settings));
                }
            }
        }
    }
    Ok(None)
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(window_ctl::WindowManager::new())
        .manage(media::MediaManager::new())
        .manage(audio::AudioManager::new())
        .manage(notifications::NotificationManager::new())
        .manage(vpn::VpnManager::new())
        .invoke_handler(tauri::generate_handler![
            frontend_log,
            // Window Shell
            window_ctl::set_window_size,
            window_ctl::get_monitors,
            window_ctl::set_target_monitor,
            // Media
            media::get_media_state,
            media::media_play_pause,
            media::media_next,
            media::media_prev,
            // Audio
            audio::get_audio_state,
            audio::audio_set_default_device,
            audio::audio_set_master_volume,
            audio::audio_set_mute,
            audio::audio_get_app_sessions,
            audio::audio_set_app_volume,
            audio::audio_set_app_mute,
            // Notifications
            notifications::notifications_request_permission,
            notifications::get_notifications,
            notifications::notifications_clear_all,
            notifications::notifications_send_test,
            // Docker
            docker::docker_get_state,
            docker::docker_start,
            docker::docker_stop,
            docker::docker_restart,
            // VPN
            vpn::vpn_save_config,
            vpn::vpn_get_state,
            vpn::vpn_toggle,
            vpn::vpn_check_delay,
            // Settings
            save_settings,
            load_settings,
            get_autostart,
            set_autostart,
        ])
        .setup(|app| {
            // Setup System Tray Menu
            let quit_i = MenuItem::with_id(app, "quit", "Quit Smart Island", true, None::<&str>)?;
            let show_i = MenuItem::with_id(app, "show", "Show Island", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("missing default window icon"))
                .tooltip("Smart Island")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        vpn::cleanup_vpn(app);
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Left-click on tray icon toggles window visibility
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Initial positioning of window (Flush top bezel active notch 384x36)
            if let Some(window) = app.get_webview_window("main") {
                println!("[SMART-ISLAND] Positioning main window at top bezel (384x36 notch)...");
                window_ctl::center_window_top(&window, 384, 36, "primary");
                let _ = window.show();
                let _ = window.set_always_on_top(true);
            } else {
                eprintln!("[SMART-ISLAND] ERROR: Could not find webview window 'main'!");
            }

            // Start background event watchers
            let handle = app.handle().clone();
            window_ctl::start_fullscreen_watcher(handle.clone());
            media::start_media_watcher(handle.clone());
            audio::start_audio_watcher(handle.clone());
            notifications::start_notification_watcher(handle.clone());

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            RunEvent::ExitRequested { code, .. } => {
                window_ctl::log_runtime(&format!("[APP] ExitRequested: code={:?}", code));
            }
            RunEvent::Exit => {
                window_ctl::log_runtime("[APP] RunEvent::Exit");
                vpn::cleanup_vpn(app_handle);
            }
            RunEvent::WindowEvent { event, label, .. } => {
                match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        // Hide window to tray instead of quitting
                        api.prevent_close();
                        if let Some(win) = app_handle.get_webview_window(&label) {
                            let _ = win.hide();
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    });
}
