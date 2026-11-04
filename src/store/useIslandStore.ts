import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface MediaState {
  isPlaying: boolean;
  title: string;
  artist: string;
  albumArt: string;
  position: number;
  duration: number;
}

export interface AudioDevice {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface AppAudioSession {
  id: string;
  pid: number;
  name: string;
  volume: number;
  isMuted: boolean;
}

export interface AudioState {
  renderDevices: AudioDevice[];
  captureDevices: AudioDevice[];
  appSessions: AppAudioSession[];
  masterVolume: number;
  isMuted: boolean;
  isAudioActive?: boolean;
  audioPeak?: number;
}

export interface NotificationItem {
  id: string;
  appName: string;
  title: string;
  body: string;
  timestamp: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: "running" | "exited" | "paused" | string;
  status: string;
  ports: string[];
}

export interface VpnMetrics {
  upBytes: number;
  downBytes: number;
  pingMs: number;
}

export interface MonitorInfo {
  id: string;
  name: string;
  isPrimary: boolean;
  width: number;
  height: number;
}

export interface TabConfig {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
}

export interface ToastBanner {
  id: string;
  appName: string;
  title: string;
  body: string;
}

export type CollapsedWidgetType = "media" | "docker" | "vpn";
export type ThemeMode = "light" | "dark" | "auto";

export const getSystemTheme = (): "light" | "dark" => {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
};

export const applyThemeToDOM = (resolved: "light" | "dark") => {
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.classList.toggle("light", resolved === "light");
  }
};

export interface TemporaryNotice {
  id: string;
  type: "toast" | "docker" | "info";
  title: string;
  subtitle?: string;
  icon?: string;
  durationMs?: number;
}

interface IslandStore {
  // Shell
  isExpanded: boolean;
  isHovered: boolean;
  isCollapsing: boolean;
  activeTab: string;
  toastBanner: ToastBanner | null;
  trackNotice: boolean;
  collapsedActiveWidget: CollapsedWidgetType;
  tempOverrideNotice: TemporaryNotice | null;
  noticeQueue: TemporaryNotice[];

  setExpanded: (expanded: boolean) => void;
  setHovered: (hovered: boolean) => void;
  setCollapsing: (collapsing: boolean) => void;
  setActiveTab: (tab: string) => void;
  setToastBanner: (toast: ToastBanner | null) => void;
  setTrackNotice: (notice: boolean) => void;
  triggerTrackNotice: () => void;
  setCollapsedActiveWidget: (widget: CollapsedWidgetType) => void;
  cycleCollapsedWidget: (direction: number) => void;
  enqueueNotice: (notice: TemporaryNotice) => void;
  dismissCurrentNotice: () => void;
  setAudioAppVolume: (pid: number, volume: number) => Promise<void>;
  setAudioAppMute: (pid: number, muted: boolean) => Promise<void>;
  refreshAudioAppSessions: () => Promise<void>;

  // Media
  media: MediaState;
  setMedia: (media: Partial<MediaState>) => void;

  // Audio
  audio: AudioState;
  setAudio: (audio: Partial<AudioState>) => void;

  // Notifications
  notifications: NotificationItem[];
  notifPermission: "allowed" | "denied" | "unsupported" | "unknown";
  setNotifications: (items: NotificationItem[]) => void;
  addNotification: (item: NotificationItem) => void;
  clearNotifications: () => void;
  setNotifPermission: (perm: "allowed" | "denied" | "unsupported" | "unknown") => void;

  // Docker
  dockerRunning: boolean;
  containers: DockerContainer[];
  dockerLoadingAction: Record<string, string | null>;
  setDockerRunning: (running: boolean) => void;
  setContainers: (containers: DockerContainer[]) => void;
  setContainerLoading: (id: string, action: string | null) => void;

  // VPN
  vpnConnected: boolean;
  vpnMode: "system-proxy" | "tun";
  vpnUriKey: string;
  vpnMetrics: VpnMetrics;
  setVpnConnected: (connected: boolean) => void;
  setVpnMode: (mode: "system-proxy" | "tun") => void;
  setVpnUriKey: (uri: string) => void;
  setVpnMetrics: (metrics: Partial<VpnMetrics>) => void;

  // Settings
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  language: "ru" | "en";
  tabsOrder: string[];
  enabledTabs: Record<string, boolean>;
  availableMonitors: MonitorInfo[];
  selectedMonitor: string;
  autostart: boolean;
  collapseTimeoutSeconds: number;
  collapseTimeoutMinutes: number;
  setTheme: (theme: ThemeMode) => void;
  setLanguage: (lang: "ru" | "en") => void;
  setTabsOrder: (order: string[]) => void;
  toggleTab: (tabId: string) => void;
  setAvailableMonitors: (monitors: MonitorInfo[]) => void;
  setSelectedMonitor: (monitorId: string) => void;
  setAutostart: (val: boolean) => void;
  setCollapseTimeoutSeconds: (sec: number) => void;
  setCollapseTimeoutMinutes: (mins: number) => void;
  saveSettingsToDisk: () => Promise<void>;
  loadSettingsFromDisk: () => Promise<void>;
}

const DEFAULT_TABS = ["media", "audio", "notifications", "docker", "vpn", "settings"];

export const useIslandStore = create<IslandStore>((set) => ({
  // Shell
  isExpanded: false,
  isHovered: false,
  isCollapsing: false,
  activeTab: "media",
  toastBanner: null,
  trackNotice: false,
  collapsedActiveWidget: "media",
  tempOverrideNotice: null,
  noticeQueue: [],
  setExpanded: (expanded) => set({ isExpanded: expanded }),
  setHovered: (hovered) => set({ isHovered: hovered }),
  setCollapsing: (collapsing) => set({ isCollapsing: collapsing }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setToastBanner: (toast) => set({ toastBanner: toast }),
  setTrackNotice: (notice) => set({ trackNotice: notice }),
  triggerTrackNotice: () => {
    set({ trackNotice: true });
    window.setTimeout(() => {
      set({ trackNotice: false });
    }, 5000);
  },
  setCollapsedActiveWidget: (widget) => set({ collapsedActiveWidget: widget }),
  cycleCollapsedWidget: (direction) => {
    const list: CollapsedWidgetType[] = ["media", "docker", "vpn"];
    set((s) => {
      const idx = list.indexOf(s.collapsedActiveWidget);
      const nextIdx = (idx + direction + list.length) % list.length;
      return { collapsedActiveWidget: list[nextIdx] };
    });
  },
  enqueueNotice: (notice) => {
    const s = useIslandStore.getState();
    if (!s.tempOverrideNotice) {
      set({ tempOverrideNotice: notice, toastBanner: null });
      const duration = notice.durationMs ?? 3200;
      window.setTimeout(() => {
        useIslandStore.getState().dismissCurrentNotice();
      }, duration);
    } else {
      set({ noticeQueue: [...s.noticeQueue, notice] });
    }
  },
  dismissCurrentNotice: () => {
    const s = useIslandStore.getState();
    if (s.noticeQueue.length > 0) {
      const [next, ...rest] = s.noticeQueue;
      set({ tempOverrideNotice: next, noticeQueue: rest, toastBanner: null });
      const duration = next.durationMs ?? 3200;
      window.setTimeout(() => {
        useIslandStore.getState().dismissCurrentNotice();
      }, duration);
    } else {
      set({ tempOverrideNotice: null, toastBanner: null });
    }
  },

  // Media
  media: {
    isPlaying: false,
    title: "No media active",
    artist: "Windows Media",
    albumArt: "",
    position: 0,
    duration: 0,
  },
  setMedia: (media) => set((s) => ({ media: { ...s.media, ...media } })),

  // Audio
  audio: {
    renderDevices: [],
    captureDevices: [],
    appSessions: [],
    masterVolume: 70,
    isMuted: false,
    isAudioActive: false,
    audioPeak: 0,
  },
  setAudio: (audio) => set((s) => ({ audio: { ...s.audio, ...audio } })),
  setAudioAppVolume: async (pid, volume) => {
    set((s) => ({
      audio: {
        ...s.audio,
        appSessions: s.audio.appSessions.map((sess) =>
          sess.pid === pid ? { ...sess, volume, isMuted: volume === 0 } : sess
        ),
      },
    }));
    try {
      await invoke("audio_set_app_volume", { pid, volume });
    } catch {}
  },
  setAudioAppMute: async (pid, muted) => {
    set((s) => ({
      audio: {
        ...s.audio,
        appSessions: s.audio.appSessions.map((sess) =>
          sess.pid === pid ? { ...sess, isMuted: muted } : sess
        ),
      },
    }));
    try {
      await invoke("audio_set_app_mute", { pid, muted });
    } catch {}
  },
  refreshAudioAppSessions: async () => {
    try {
      const sessions = await invoke<AppAudioSession[]>("audio_get_app_sessions");
      if (sessions) {
        set((s) => ({
          audio: {
            ...s.audio,
            appSessions: sessions,
          },
        }));
      }
    } catch {}
  },

  // Notifications
  notifications: [],
  notifPermission: "unknown",
  setNotifications: (items) => set({ notifications: items.slice(0, 15) }),
  addNotification: (item) =>
    set((s) => ({
      notifications: [item, ...s.notifications.filter((n) => n.id !== item.id)].slice(0, 15),
    })),
  clearNotifications: () => set({ notifications: [] }),
  setNotifPermission: (perm) => set({ notifPermission: perm }),

  // Docker
  dockerRunning: false,
  containers: [],
  dockerLoadingAction: {},
  setDockerRunning: (running) => set({ dockerRunning: running }),
  setContainers: (containers) => set({ containers }),
  setContainerLoading: (id, action) =>
    set((s) => ({
      dockerLoadingAction: { ...s.dockerLoadingAction, [id]: action },
    })),

  // VPN
  vpnConnected: false,
  vpnMode: "system-proxy",
  vpnUriKey: "",
  vpnMetrics: { upBytes: 0, downBytes: 0, pingMs: 0 },
  setVpnConnected: (connected) => set({ vpnConnected: connected }),
  setVpnMode: (mode) => {
    set({ vpnMode: mode });
    useIslandStore.getState().saveSettingsToDisk();
  },
  setVpnUriKey: (uri) => {
    set({ vpnUriKey: uri });
    useIslandStore.getState().saveSettingsToDisk();
  },
  setVpnMetrics: (m) => set((s) => ({ vpnMetrics: { ...s.vpnMetrics, ...m } })),

  // Settings
  theme: "auto",
  resolvedTheme: getSystemTheme(),
  language: "ru",
  tabsOrder: DEFAULT_TABS,
  enabledTabs: {
    media: true,
    audio: true,
    notifications: true,
    docker: true,
    vpn: true,
    settings: true,
  },
  availableMonitors: [],
  selectedMonitor: "primary",
  autostart: false,
  collapseTimeoutSeconds: 300,
  collapseTimeoutMinutes: 5,
  setTheme: (theme) => {
    const resolved = theme === "auto" ? getSystemTheme() : theme;
    applyThemeToDOM(resolved);
    set({ theme, resolvedTheme: resolved });
    useIslandStore.getState().saveSettingsToDisk();
  },
  setLanguage: (lang) => {
    set({ language: lang });
    useIslandStore.getState().saveSettingsToDisk();
  },
  setTabsOrder: (order) => {
    set({ tabsOrder: order });
    useIslandStore.getState().saveSettingsToDisk();
  },
  toggleTab: (tabId) => {
    set((s) => ({
      enabledTabs: { ...s.enabledTabs, [tabId]: !s.enabledTabs[tabId] },
    }));
    useIslandStore.getState().saveSettingsToDisk();
  },
  setAvailableMonitors: (monitors) => set({ availableMonitors: monitors }),
  setSelectedMonitor: (monitorId) => {
    set({ selectedMonitor: monitorId });
    useIslandStore.getState().saveSettingsToDisk();
  },
  setAutostart: async (val) => {
    set({ autostart: val });
    try {
      await invoke("set_autostart", { enable: val });
    } catch {}
    useIslandStore.getState().saveSettingsToDisk();
  },
  setCollapseTimeoutSeconds: (sec) => {
    set({ collapseTimeoutSeconds: sec, collapseTimeoutMinutes: Math.round(sec / 60) });
    useIslandStore.getState().saveSettingsToDisk();
  },
  setCollapseTimeoutMinutes: (mins) => {
    set({ collapseTimeoutSeconds: mins * 60, collapseTimeoutMinutes: mins });
    useIslandStore.getState().saveSettingsToDisk();
  },
  saveSettingsToDisk: async () => {
    const s = useIslandStore.getState();
    try {
      await invoke("save_settings", {
        tabsOrder: s.tabsOrder,
        enabledTabs: s.enabledTabs,
        selectedMonitor: s.selectedMonitor,
        language: s.language,
        autostart: s.autostart,
        collapseTimeoutSeconds: s.collapseTimeoutSeconds,
        collapseTimeoutMinutes: Math.round(s.collapseTimeoutSeconds / 60),
        theme: s.theme,
        vpnUriKey: s.vpnUriKey,
        vpnMode: s.vpnMode,
      });
    } catch {}
  },
  loadSettingsFromDisk: async () => {
    try {
      const res = await invoke<any>("load_settings");
      if (res) {
        const rawOrder = Array.isArray(res.tabsOrder) && res.tabsOrder.length > 0 ? res.tabsOrder : DEFAULT_TABS;
        const sanitizedOrder: string[] = [];
        for (const t of rawOrder) {
          if (t !== "calendar" && t !== "agent" && !sanitizedOrder.includes(t)) {
            sanitizedOrder.push(t);
          }
        }
        if (!sanitizedOrder.includes("vpn")) sanitizedOrder.push("vpn");
        if (!sanitizedOrder.includes("settings")) sanitizedOrder.push("settings");

        const rawEnabled = res.enabledTabs || {};
        const sanitizedEnabled = {
          media: rawEnabled.media !== false,
          audio: rawEnabled.audio !== false,
          notifications: rawEnabled.notifications !== false,
          docker: rawEnabled.docker !== false,
          vpn: rawEnabled.vpn !== false,
          settings: rawEnabled.settings !== false,
        };

        const theme: ThemeMode = res.theme === "light" || res.theme === "dark" || res.theme === "auto" ? res.theme : "auto";
        const resolvedTheme = theme === "auto" ? getSystemTheme() : theme;
        applyThemeToDOM(resolvedTheme);

        const timeoutSec = res.collapseTimeoutSeconds ?? (res.collapseTimeoutMinutes ? res.collapseTimeoutMinutes * 60 : 300);
        const vpnUriKey = res.vpnUriKey || res.vpn_uri_key || "";
        const vpnMode = res.vpnMode || res.vpn_mode || "system-proxy";

        set({
          tabsOrder: sanitizedOrder,
          enabledTabs: sanitizedEnabled,
          selectedMonitor: res.selectedMonitor || "primary",
          language: res.language || "ru",
          autostart: Boolean(res.autostart),
          collapseTimeoutSeconds: timeoutSec,
          collapseTimeoutMinutes: Math.round(timeoutSec / 60),
          theme,
          resolvedTheme,
          vpnUriKey,
          vpnMode,
        });
      }
      const autostartActive = await invoke<boolean>("get_autostart");
      set({ autostart: Boolean(autostartActive) });
    } catch {}
  },
}));

// Listen to OS system color-scheme changes for auto mode
if (typeof window !== "undefined" && window.matchMedia) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (e: MediaQueryListEvent) => {
    const s = useIslandStore.getState();
    if (s.theme === "auto") {
      const resolved = e.matches ? "dark" : "light";
      useIslandStore.setState({ resolvedTheme: resolved });
      applyThemeToDOM(resolved);
    }
  };
  if (mq.addEventListener) {
    mq.addEventListener("change", listener);
  }
}
