use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

#[cfg(windows)]
use windows::UI::Notifications::Management::{
    UserNotificationListener, UserNotificationListenerAccessStatus,
};
#[cfg(windows)]
use windows::UI::Notifications::NotificationKinds;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NotificationItem {
    pub id: String,
    pub app_name: String,
    pub title: String,
    pub body: String,
    pub timestamp: String,
}

pub struct NotificationManager {
    pub last_known_id: Mutex<u32>,
}

impl NotificationManager {
    pub fn new() -> Self {
        Self {
            last_known_id: Mutex::new(0),
        }
    }
}

#[cfg(windows)]
fn fetch_system_notifications() -> Vec<NotificationItem> {
    let listener = match UserNotificationListener::Current() {
        Ok(l) => l,
        Err(_) => return Vec::new(),
    };

    let status = listener.GetAccessStatus().unwrap_or(UserNotificationListenerAccessStatus::Unspecified);
    if status != UserNotificationListenerAccessStatus::Allowed {
        return Vec::new();
    }

    let notifs = match listener.GetNotificationsAsync(NotificationKinds::Toast) {
        Ok(op) => match op.get() {
            Ok(n) => n,
            Err(_) => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };

    let count = notifs.Size().unwrap_or(0);
    let mut items = Vec::new();

    for i in 0..count {
        if let Ok(toast) = notifs.GetAt(i) {
            let id = toast.Id().unwrap_or(0);
            let app_info = toast.AppInfo().ok();
            let app_name = app_info
                .and_then(|info| info.DisplayInfo().ok())
                .and_then(|disp| disp.DisplayName().ok())
                .map(|h| h.to_string())
                .unwrap_or_else(|| "System".to_string());

            let mut title = String::new();
            let mut body = String::new();

            if let Ok(notification) = toast.Notification() {
                if let Ok(visual) = notification.Visual() {
                    if let Ok(bindings) = visual.Bindings() {
                        let b_count = bindings.Size().unwrap_or(0);
                        for b_idx in 0..b_count {
                            if let Ok(binding) = bindings.GetAt(b_idx) {
                                if let Ok(texts) = binding.GetTextElements() {
                                    let t_size = texts.Size().unwrap_or(0);
                                    if t_size > 0 {
                                        if let Ok(elem) = texts.GetAt(0) {
                                            title = elem.Text().map(|t| t.to_string()).unwrap_or_default();
                                        }
                                    }
                                    if t_size > 1 {
                                        if let Ok(elem) = texts.GetAt(1) {
                                            body = elem.Text().map(|t| t.to_string()).unwrap_or_default();
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if !title.is_empty() || !body.is_empty() {
                items.push(NotificationItem {
                    id: id.to_string(),
                    app_name,
                    title,
                    body,
                    timestamp: "Just now".to_string(),
                });
            }
        }
    }

    items.reverse();
    items.truncate(15);
    items
}

#[tauri::command]
pub async fn notifications_request_permission() -> Result<String, String> {
    let res = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        tokio::task::spawn_blocking(|| {
            #[cfg(windows)]
            {
                if let Ok(listener) = UserNotificationListener::Current() {
                    if let Ok(op) = listener.RequestAccessAsync() {
                        if let Ok(status) = op.get() {
                            return match status {
                                UserNotificationListenerAccessStatus::Allowed => "allowed".to_string(),
                                UserNotificationListenerAccessStatus::Denied => "denied".to_string(),
                                _ => "unknown".to_string(),
                            };
                        }
                    }
                }
            }
            "denied".to_string()
        }),
    )
    .await;

    match res {
        Ok(Ok(status)) => Ok(status),
        _ => Ok("denied".to_string()),
    }
}

#[tauri::command]
pub async fn get_notifications() -> Result<Vec<NotificationItem>, String> {
    let res = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        tokio::task::spawn_blocking(|| {
            #[cfg(windows)]
            {
                fetch_system_notifications()
            }
            #[cfg(not(windows))]
            {
                Vec::new()
            }
        }),
    )
    .await;

    match res {
        Ok(Ok(items)) => Ok(items),
        _ => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn notifications_clear_all() -> Result<(), String> {
    let _ = tokio::task::spawn_blocking(|| {
        #[cfg(windows)]
        {
            if let Ok(listener) = UserNotificationListener::Current() {
                let _ = listener.ClearNotifications();
            }
        }
    })
    .await;
    Ok(())
}

/// Background loop monitoring new toast notifications (AC 3.3)
pub fn start_notification_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(1500));
        let mut last_seen_id: Option<String> = None;

        loop {
            interval.tick().await;

            let res = tokio::time::timeout(
                std::time::Duration::from_millis(500),
                tokio::task::spawn_blocking(|| {
                    #[cfg(windows)]
                    {
                        fetch_system_notifications()
                    }
                    #[cfg(not(windows))]
                    {
                        Vec::new()
                    }
                }),
            )
            .await;

            if let Ok(Ok(items)) = res {
                if let Some(first) = items.first() {
                    match &last_seen_id {
                        None => {
                            last_seen_id = Some(first.id.clone());
                        }
                        Some(prev_id) if prev_id != &first.id => {
                            last_seen_id = Some(first.id.clone());
                            let _ = app.emit("toast-received", first);
                        }
                        _ => {}
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub fn notifications_send_test(app: AppHandle) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let test_item = NotificationItem {
        id: format!("test-{}", now),
        app_name: "Telegram".to_string(),
        title: "Сообщение от Анны".to_string(),
        body: "Макет островка и системные уведомления работают отлично!".to_string(),
        timestamp: "Just now".to_string(),
    };
    let _ = app.emit("toast-received", &test_item);
    Ok(())
}
