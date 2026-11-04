use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    },
    Storage::Streams::{DataReader, InputStreamOptions},
};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub is_playing: bool,
    pub title: String,
    pub artist: String,
    pub album_art: String,
    pub position: f64,
    pub duration: f64,
}

pub struct MediaManager {
    pub current_state: Mutex<MediaState>,
}

impl MediaManager {
    pub fn new() -> Self {
        Self {
            current_state: Mutex::new(MediaState::default()),
        }
    }
}

#[cfg(windows)]
fn read_stream_base64(
    stream_ref: windows::Storage::Streams::IRandomAccessStreamReference,
) -> Option<String> {
    let stream = stream_ref.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > 2 * 1024 * 1024 {
        return None;
    }

    let input_stream = stream.GetInputStreamAt(0).ok()?;
    let reader = DataReader::CreateDataReader(&input_stream).ok()?;
    reader.SetInputStreamOptions(InputStreamOptions::Partial).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;

    let mut bytes = vec![0u8; size as usize];
    reader.ReadBytes(&mut bytes).ok()?;

    let b64 = BASE64.encode(&bytes);
    Some(format!("data:image/jpeg;base64,{}", b64))
}

#[cfg(windows)]
unsafe fn find_browser_media_fallback() -> Option<MediaState> {
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowTextLengthW, GetWindowTextW, IsWindowVisible,
    };
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};

    struct EnumData {
        found: Option<MediaState>,
    }

    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam.0 as *mut EnumData);
        if IsWindowVisible(hwnd).as_bool() {
            let len = GetWindowTextLengthW(hwnd);
            if len > 5 {
                let mut buf = vec![0u16; (len + 1) as usize];
                let copied = GetWindowTextW(hwnd, &mut buf);
                if copied > 0 {
                    let title_full = String::from_utf16_lossy(&buf[..copied as usize]);
                    for pattern in &[" - YouTube", " – YouTube", " - Twitch", " - SoundCloud", " - Яндекс Музыка", " - Spotify"] {
                        if let Some(pos) = title_full.find(pattern) {
                            let mut track_title = title_full[..pos].trim().to_string();
                            if track_title.starts_with('(') {
                                if let Some(close_paren) = track_title.find(") ") {
                                    track_title = track_title[close_paren + 2..].trim().to_string();
                                }
                            }
                            let app_name = pattern.trim_start_matches(|c| c == ' ' || c == '-' || c == '–').trim().to_string();

                            data.found = Some(MediaState {
                                is_playing: true,
                                title: track_title,
                                artist: app_name,
                                album_art: String::new(),
                                position: 0.0,
                                duration: 0.0,
                            });
                            return BOOL(0); // Stop enumeration
                        }
                    }
                }
            }
        }
        BOOL(1) // Continue
    }

    let mut data = EnumData { found: None };
    let _ = EnumWindows(Some(enum_proc), LPARAM(&mut data as *mut _ as isize));
    data.found
}

#[cfg(windows)]
pub fn fetch_current_media_state() -> Option<MediaState> {
    // 1. Try Windows GSMTC (covers Chrome, Edge, Spotify, VLC, iTunes, etc.)
    if let Ok(op) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
        if let Ok(manager) = op.get() {
            let mut candidate = None;

            // A. Check if any session is actively Playing
            if let Ok(sessions) = manager.GetSessions() {
                let count = sessions.Size().unwrap_or(0);
                for i in 0..count {
                    if let Ok(s) = sessions.GetAt(i) {
                        if let Ok(pb) = s.GetPlaybackInfo() {
                            if let Ok(status) = pb.PlaybackStatus() {
                                if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                                    candidate = Some((s, true));
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // B. Check GetCurrentSession if nothing was actively Playing
            if candidate.is_none() {
                if let Ok(curr) = manager.GetCurrentSession() {
                    let is_playing = curr.GetPlaybackInfo()
                        .ok()
                        .and_then(|pb| pb.PlaybackStatus().ok())
                        .map(|s| {
                            s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                                || (s != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused
                                    && s != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped)
                        })
                        .unwrap_or(false);
                    candidate = Some((curr, is_playing));
                }
            }

            // C. Check first session in GetSessions as fallback
            if candidate.is_none() {
                if let Ok(sessions) = manager.GetSessions() {
                    if sessions.Size().unwrap_or(0) > 0 {
                        if let Ok(first) = sessions.GetAt(0) {
                            let is_playing = first.GetPlaybackInfo()
                                .ok()
                                .and_then(|pb| pb.PlaybackStatus().ok())
                                .map(|s| {
                                    s == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing
                                        || (s != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused
                                            && s != GlobalSystemMediaTransportControlsSessionPlaybackStatus::Stopped)
                                })
                                .unwrap_or(false);
                            candidate = Some((first, is_playing));
                        }
                    }
                }
            }

            if let Some((session, mut is_playing)) = candidate {
                #[cfg(windows)]
                unsafe {
                    if crate::audio::get_master_audio_peak() > 0.001 {
                        is_playing = true;
                    }
                }

                if let Ok(op) = session.TryGetMediaPropertiesAsync() {
                    if let Ok(media_prop) = op.get() {
                        let title = media_prop.Title().ok().map(|t| t.to_string()).unwrap_or_default();
                        let mut artist = media_prop.Artist().ok().map(|a| a.to_string()).unwrap_or_default();

                        if artist.is_empty() {
                            if let Ok(src_id) = session.SourceAppUserModelId() {
                                let id_str = src_id.to_string();
                                if id_str.to_lowercase().contains("chrome") {
                                    artist = "Chrome Media".to_string();
                                } else if id_str.to_lowercase().contains("edge") {
                                    artist = "Edge Media".to_string();
                                } else if id_str.to_lowercase().contains("spotify") {
                                    artist = "Spotify".to_string();
                                } else {
                                    artist = id_str;
                                }
                            }
                        }

                        if !title.is_empty() {
                            let mut album_art = String::new();
                            if let Ok(thumb_ref) = media_prop.Thumbnail() {
                                if let Some(art) = read_stream_base64(thumb_ref) {
                                    album_art = art;
                                }
                            }

                            let timeline = session.GetTimelineProperties().ok();
                            let (position, duration) = if let Some(t) = timeline {
                                let mut pos = t.Position().map(|p| p.Duration as f64 / 10_000_000.0).unwrap_or(0.0);
                                let dur = t.EndTime().map(|e| e.Duration as f64 / 10_000_000.0).unwrap_or(0.0);
                                if is_playing {
                                    if let Ok(last_updated) = t.LastUpdatedTime() {
                                        if let Ok(unix_dur) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
                                            let now_100ns = (unix_dur.as_secs() + 11_644_473_600) * 10_000_000 + (unix_dur.subsec_nanos() as u64 / 100);
                                            let updated_100ns = last_updated.UniversalTime as u64;
                                            if now_100ns > updated_100ns {
                                                let elapsed_secs = (now_100ns - updated_100ns) as f64 / 10_000_000.0;
                                                if elapsed_secs < 86400.0 {
                                                    pos += elapsed_secs;
                                                }
                                            }
                                        }
                                    }
                                }
                                if dur > 0.0 && pos > dur {
                                    pos = dur;
                                }
                                (pos, dur)
                            } else {
                                (0.0, 0.0)
                            };

                            return Some(MediaState {
                                is_playing,
                                title,
                                artist,
                                album_art,
                                position,
                                duration,
                            });
                        }
                    }
                }
            }
        }
    }

    // 2. Fallback: Check visible browser windows for YouTube/Twitch/etc.
    unsafe {
        find_browser_media_fallback()
    }
}

#[tauri::command]
pub async fn get_media_state() -> Result<MediaState, String> {
    let result = tokio::time::timeout(std::time::Duration::from_millis(1200), tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            if let Some(state) = fetch_current_media_state() {
                return state;
            }
        }
        MediaState::default()
    })).await;

    match result {
        Ok(Ok(state)) => Ok(state),
        _ => Ok(MediaState::default()),
    }
}

#[tauri::command]
pub async fn media_play_pause() -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            if let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                if let Ok(mgr) = manager.get() {
                    if let Ok(sessions) = mgr.GetSessions() {
                        let count = sessions.Size().unwrap_or(0);
                        for i in 0..count {
                            if let Ok(s) = sessions.GetAt(i) {
                                if let Ok(pb) = s.GetPlaybackInfo() {
                                    if let Ok(status) = pb.PlaybackStatus() {
                                        if status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing {
                                            let _ = s.TryTogglePlayPauseAsync();
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let Ok(session) = mgr.GetCurrentSession() {
                        let _ = session.TryTogglePlayPauseAsync();
                    } else if let Ok(sessions) = mgr.GetSessions() {
                        if sessions.Size().unwrap_or(0) > 0 {
                            if let Ok(first) = sessions.GetAt(0) {
                                let _ = first.TryTogglePlayPauseAsync();
                            }
                        }
                    }
                }
            }
        }
    }).await;
    Ok(())
}

#[tauri::command]
pub async fn media_next() -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            if let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                if let Ok(mgr) = manager.get() {
                    if let Ok(session) = mgr.GetCurrentSession() {
                        let _ = session.TrySkipNextAsync();
                    } else if let Ok(sessions) = mgr.GetSessions() {
                        if sessions.Size().unwrap_or(0) > 0 {
                            if let Ok(first) = sessions.GetAt(0) {
                                let _ = first.TrySkipNextAsync();
                            }
                        }
                    }
                }
            }
        }
    }).await;
    Ok(())
}

#[tauri::command]
pub async fn media_prev() -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            if let Ok(manager) = GlobalSystemMediaTransportControlsSessionManager::RequestAsync() {
                if let Ok(mgr) = manager.get() {
                    if let Ok(session) = mgr.GetCurrentSession() {
                        let _ = session.TrySkipPreviousAsync();
                    } else if let Ok(sessions) = mgr.GetSessions() {
                        if sessions.Size().unwrap_or(0) > 0 {
                            if let Ok(first) = sessions.GetAt(0) {
                                let _ = first.TrySkipPreviousAsync();
                            }
                        }
                    }
                }
            }
        }
    }).await;
    Ok(())
}

/// Background loop monitoring Windows media updates and emitting to frontend
pub fn start_media_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(800));
        let mut last_title = String::new();
        let mut last_playing = false;
        let mut last_pos = 0.0f64;
        let mut last_emit_instant = std::time::Instant::now();

        loop {
            interval.tick().await;

            let maybe_state = tokio::time::timeout(
                std::time::Duration::from_millis(1200),
                tokio::task::spawn_blocking(fetch_current_media_state),
            )
            .await;

            match maybe_state {
                Ok(Ok(Some(state))) => {
                    let title_changed = state.title != last_title;
                    let playing_changed = state.is_playing != last_playing;
                    let time_elapsed = last_emit_instant.elapsed().as_secs_f64() >= 1.0;
                    let pos_jump = (state.position - last_pos).abs() > 2.0;

                    let should_emit = title_changed || playing_changed || (state.is_playing && (time_elapsed || pos_jump));

                    if should_emit {
                        if title_changed || playing_changed {
                            crate::window_ctl::log_runtime(&format!(
                                "[MEDIA-SYNC] Detected: playing={}, title='{}', artist='{}'",
                                state.is_playing, state.title, state.artist
                            ));
                        }
                        last_title = state.title.clone();
                        last_playing = state.is_playing;
                        last_pos = state.position;
                        last_emit_instant = std::time::Instant::now();
                        let _ = app.emit("media-updated", &state);
                    }
                }
                Ok(Ok(None)) => {
                    if last_playing {
                        crate::window_ctl::log_runtime("[MEDIA-SYNC] All media stopped");
                        last_playing = false;
                        last_pos = 0.0;
                        let empty_state = MediaState {
                            is_playing: false,
                            title: last_title.clone(),
                            ..Default::default()
                        };
                        let _ = app.emit("media-updated", &empty_state);
                    }
                }
                _ => {}
            }
        }
    });
}
