import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useIslandStore, NotificationItem, MediaState, AudioState, DockerContainer } from "../store/useIslandStore";

function normalizeMedia(data: any): MediaState {
  if (!data) {
    return {
      isPlaying: false,
      title: "No media active",
      artist: "Windows Media",
      albumArt: "",
      position: 0,
      duration: 0,
    };
  }
  return {
    isPlaying: Boolean(data.isPlaying ?? data.is_playing),
    title: data.title || "No media active",
    artist: data.artist || "Windows Media",
    albumArt: data.albumArt || data.album_art || "",
    position: Number(data.position || 0),
    duration: Number(data.duration || 0),
  };
}

function normalizeAudio(data: any): Partial<AudioState> {
  if (!data) return {};
  const renderRaw = data.renderDevices || data.render_devices || [];
  const captureRaw = data.captureDevices || data.capture_devices || [];
  const appSessionsRaw = data.appSessions || data.app_sessions || [];

  return {
    renderDevices: renderRaw.map((d: any) => ({
      id: d.id,
      name: d.name,
      isDefault: Boolean(d.isDefault ?? d.is_default),
    })),
    captureDevices: captureRaw.map((d: any) => ({
      id: d.id,
      name: d.name,
      isDefault: Boolean(d.isDefault ?? d.is_default),
    })),
    appSessions: appSessionsRaw.map((s: any) => ({
      id: s.id || `${s.pid}:${s.name}`,
      pid: Number(s.pid),
      name: s.name,
      volume: Number(s.volume ?? 100),
      isMuted: Boolean(s.isMuted ?? s.is_muted),
    })),
    masterVolume: data.masterVolume ?? data.master_volume ?? 70,
    isMuted: Boolean(data.isMuted ?? data.is_muted),
    isAudioActive: Boolean(data.isAudioActive ?? data.is_audio_active),
    audioPeak: Number(data.audioPeak ?? data.audio_peak ?? 0),
  };
}

function normalizeToast(data: any): NotificationItem {
  return {
    id: data.id || String(Date.now()),
    appName: data.appName || data.app_name || "Windows Alert",
    title: data.title || "",
    body: data.body || "",
    timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

export function useTauriEvents() {
  const isExpanded = useIslandStore((s) => s.isExpanded);
  const setMedia = useIslandStore((s) => s.setMedia);
  const setAudio = useIslandStore((s) => s.setAudio);
  const addNotification = useIslandStore((s) => s.addNotification);
  const setNotifications = useIslandStore((s) => s.setNotifications);
  const setToastBanner = useIslandStore((s) => s.setToastBanner);
  const setContainers = useIslandStore((s) => s.setContainers);
  const setDockerRunning = useIslandStore((s) => s.setDockerRunning);
  const setVpnConnected = useIslandStore((s) => s.setVpnConnected);
  const setAvailableMonitors = useIslandStore((s) => s.setAvailableMonitors);

  useEffect(() => {
    // Initial fetch from backend with diagnostics
    invoke<any>("get_media_state")
      .then((data) => {
        const norm = normalizeMedia(data);
        invoke("frontend_log", { message: `[INIT] get_media_state: isPlaying=${norm.isPlaying}, title=${norm.title}` }).catch(() => {});
        setMedia(norm);
      })
      .catch((e) => {
        invoke("frontend_log", { message: `[INIT] get_media_state error: ${e}` }).catch(() => {});
      });

    invoke<any>("get_audio_state")
      .then((data) => {
        const norm = normalizeAudio(data);
        setAudio(norm);
      })
      .catch((e) => {
        invoke("frontend_log", { message: `[INIT] get_audio_state error: ${e}` }).catch(() => {});
      });

    invoke<any[]>("get_notifications")
      .then((data) => {
        const items = (data || []).map(normalizeToast);
        setNotifications(items);
      })
      .catch((e) => {
        invoke("frontend_log", { message: `[INIT] get_notifications error: ${e}` }).catch(() => {});
      });

    invoke<any>("docker_get_state")
      .then((res) => {
        const isRunning = Boolean(res?.isRunning ?? res?.is_running);
        setDockerRunning(isRunning);
        setContainers(res?.containers || []);
      })
      .catch((e) => {
        invoke("frontend_log", { message: `[INIT] docker_get_state error: ${e}` }).catch(() => {});
        setDockerRunning(false);
      });

    invoke<any>("vpn_get_state")
      .then((res) => {
        setVpnConnected(Boolean(res?.connected));
      })
      .catch((e) => {
        invoke("frontend_log", { message: `[INIT] vpn_get_state error: ${e}` }).catch(() => {});
      });

    invoke<any[]>("get_monitors")
      .then((monitors) => {
        const mapped = (monitors || []).map((m) => ({
          id: m.id,
          name: m.name,
          isPrimary: Boolean(m.isPrimary ?? m.is_primary),
          width: m.width,
          height: m.height,
        }));
        setAvailableMonitors(mapped);
      })
      .catch((e) => {
        invoke("frontend_log", { message: `[INIT] get_monitors error: ${e}` }).catch(() => {});
      });

    // Listen to async push events from Rust Emitter
    const unlistenMedia = listen<any>("media-updated", (event) => {
      const norm = normalizeMedia(event.payload);
      const prevMedia = useIslandStore.getState().media;
      setMedia(norm);
      if (
        norm.title &&
        norm.title !== prevMedia.title &&
        norm.isPlaying
      ) {
        useIslandStore.getState().triggerTrackNotice();
      }
    });

    const unlistenAudio = listen<any>("audio-device-changed", (event) => {
      setAudio(normalizeAudio(event.payload));
    });

    const unlistenAudioActivity = listen<any>(
      "audio-activity-changed",
      (event) => {
        const isAudioActive = Boolean(event.payload.isAudioActive ?? event.payload.is_audio_active);
        const audioPeak = Number(event.payload.audioPeak ?? event.payload.audio_peak ?? 0);
        setAudio({ isAudioActive, audioPeak });
      }
    );

    let lastToastId = "";
    let lastToastTime = 0;
    let inDrawerToastTimer: number | null = null;

    const unlistenToast = listen<any>("toast-received", (event) => {
      const notif = normalizeToast(event.payload);
      const now = Date.now();
      const toastKey = `${notif.id || ""}:${notif.appName || ""}:${notif.title || ""}`;

      // Deduplicate rapid repeat events within 2.5 seconds
      if (toastKey === lastToastId && now - lastToastTime < 2500) {
        return;
      }
      lastToastId = toastKey;
      lastToastTime = now;

      invoke("frontend_log", { message: `[TOAST] Received: ${notif.title || notif.appName}` }).catch(() => {});
      addNotification(notif);

      const isHovered = useIslandStore.getState().isHovered;
      if (isHovered) {
        // When drawer is expanded, show a brief banner inside the header
        setToastBanner(notif);
        if (inDrawerToastTimer) clearTimeout(inDrawerToastTimer);
        inDrawerToastTimer = window.setTimeout(() => {
          setToastBanner(null);
        }, 3200);
      } else {
        // When island is collapsed, wake up notch with 3.2s temporary notice
        setToastBanner(null);
        useIslandStore.getState().enqueueNotice({
          id: notif.id,
          type: "toast",
          title: notif.appName || "Notification",
          subtitle: notif.title || notif.body,
          durationMs: 3200,
        });
      }
    });

    const unlistenDocker = listen<any>(
      "docker-status-changed",
      (event) => {
        const isRunning = Boolean(event.payload.isRunning ?? event.payload.is_running);
        const prevRunning = useIslandStore.getState().dockerRunning;
        setDockerRunning(isRunning);
        setContainers(event.payload.containers || []);

        if (prevRunning !== isRunning) {
          useIslandStore.getState().enqueueNotice({
            id: `docker-${Date.now()}`,
            type: "docker",
            title: "Docker",
            subtitle: isRunning ? "Engine is active" : "Engine stopped",
            durationMs: 3500,
          });
        }
      }
    );

    const unlistenVpn = listen<any>("vpn-status-changed", (event) => {
      setVpnConnected(Boolean(event.payload.connected));
    });

    // Poll VPN core health: detect when the core process exits unexpectedly
    // after a successful initial startup (e.g. remote server closed, config issue mid-session)
    const vpnHealthInterval = setInterval(async () => {
      const isConnected = useIslandStore.getState().vpnConnected;
      if (!isConnected) return;
      try {
        const state = await invoke<any>("vpn_get_state");
        if (!state?.connected) {
          setVpnConnected(false);
          useIslandStore.getState().enqueueNotice({
            id: `vpn-crash-${Date.now()}`,
            type: "toast",
            title: "VPN",
            subtitle: "Ядро VPN завершило работу",
            durationMs: 5000,
          });
        }
      } catch {
        // Backend unreachable — don't change state
      }
    }, 3000);

    // Reactive ticking interval for smooth playback timer advance (every 1s)
    const mediaTickInterval = setInterval(() => {
      const current = useIslandStore.getState().media;
      if (current.isPlaying && current.duration > 0) {
        if (current.position < current.duration) {
          useIslandStore.getState().setMedia({
            position: Math.min(current.duration, current.position + 1),
          });
        }
      }
    }, 1000);

    return () => {
      clearInterval(mediaTickInterval);
      clearInterval(vpnHealthInterval);
      unlistenMedia.then((f) => f());
      unlistenAudio.then((f) => f());
      unlistenAudioActivity.then((f) => f());
      unlistenToast.then((f) => f());
      unlistenDocker.then((f) => f());
      unlistenVpn.then((f) => f());
    };
  }, [isExpanded, setMedia, setAudio, addNotification, setNotifications, setToastBanner, setContainers, setDockerRunning, setVpnConnected, setAvailableMonitors]);
}
