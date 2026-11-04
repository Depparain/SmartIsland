import React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings,
  Globe,
  Monitor,
  Sliders,
  Check,
  Power,
  Timer,
  RotateCcw,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";
import { useIslandStore, MonitorInfo, ThemeMode } from "../../store/useIslandStore";
import { useTranslation } from "../../core/i18n/useTranslation";
import { pluginRegistry } from "../../core/plugins/registry";

export const SettingsWidget: React.FC = () => {
  const { t, language, setLanguage } = useTranslation();
  const availableMonitors = useIslandStore((s) => s.availableMonitors);
  const selectedMonitor = useIslandStore((s) => s.selectedMonitor);
  const setSelectedMonitor = useIslandStore((s) => s.setSelectedMonitor);
  const enabledTabs = useIslandStore((s) => s.enabledTabs);
  const toggleTab = useIslandStore((s) => s.toggleTab);
  const autostart = useIslandStore((s) => s.autostart);
  const setAutostart = useIslandStore((s) => s.setAutostart);
  const collapseTimeoutSeconds = useIslandStore((s) => s.collapseTimeoutSeconds);
  const setCollapseTimeoutSeconds = useIslandStore((s) => s.setCollapseTimeoutSeconds);

  // Theming
  const theme = useIslandStore((s) => s.theme);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);
  const setTheme = useIslandStore((s) => s.setTheme);

  const handleSelectMonitor = async (id: string) => {
    setSelectedMonitor(id);
    try {
      await invoke("set_target_monitor", { monitorId: id });
    } catch {}
  };

  const handleResetDefaults = () => {
    setLanguage("ru");
    setTheme("auto");
    setAutostart(false);
    setCollapseTimeoutSeconds(300);
    setSelectedMonitor("primary");
    useIslandStore.setState({
      enabledTabs: {
        media: true,
        audio: true,
        notifications: true,
        docker: true,
        vpn: true,
        settings: true,
      },
    });
    useIslandStore.getState().saveSettingsToDisk();
  };

  const isLight = resolvedTheme === "light";

  return (
    <div className={`h-full flex flex-col p-1 select-none overflow-y-auto space-y-2.5 pr-1 ${
      isLight ? "text-neutral-900" : "text-white"
    }`}>
      {/* Header */}
      <div className={`flex items-center justify-between pb-1.5 border-b shrink-0 ${
        isLight ? "border-black/10" : "border-white/10"
      }`}>
        <div className={`flex items-center gap-1.5 text-xs ${
          isLight ? "text-neutral-700" : "text-white/70"
        }`}>
          <Settings className="w-3.5 h-3.5 text-sky-500" />
          <span className="font-semibold">{t("settings.title")}</span>
        </div>

        <button
          onClick={handleResetDefaults}
          className={`flex items-center gap-1 text-[10px] transition ${
            isLight ? "text-neutral-400 hover:text-neutral-800" : "text-white/40 hover:text-white/80"
          }`}
          title={t("settings.resetDefaults")}
        >
          <RotateCcw className="w-2.5 h-2.5" />
          <span>{t("settings.resetDefaults")}</span>
        </button>
      </div>

      {/* 1. Theme Switcher */}
      <div className={`${
        isLight ? "bg-black/[0.04] border border-black/10" : "bg-white/5 border border-white/10"
      } rounded-xl p-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          {theme === "light" ? (
            <Sun className="w-4 h-4 text-amber-500" />
          ) : theme === "dark" ? (
            <Moon className="w-4 h-4 text-indigo-400" />
          ) : (
            <Laptop className="w-4 h-4 text-sky-500" />
          )}
          <div className="flex flex-col">
            <span className="text-[11.5px] font-semibold">{t("settings.theme")}</span>
            <span className={`text-[9.5px] ${isLight ? "text-neutral-500" : "text-white/40"}`}>
              {theme === "auto"
                ? `${t("settings.themeAuto")} (${resolvedTheme === "dark" ? t("settings.themeDark") : t("settings.themeLight")})`
                : t("settings.themeDesc")}
            </span>
          </div>
        </div>

        <div className={`flex items-center p-0.5 rounded-lg text-[10.5px] gap-0.5 ${
          isLight ? "bg-black/10" : "bg-white/10"
        }`}>
          <button
            onClick={() => setTheme("light")}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition ${
              theme === "light"
                ? isLight
                  ? "bg-amber-500/25 text-amber-900 font-bold shadow-sm"
                  : "bg-amber-500/30 text-amber-200 font-semibold shadow-sm"
                : isLight
                ? "text-neutral-600 hover:text-neutral-900 font-medium"
                : "text-white/60 hover:text-white font-medium"
            }`}
          >
            <Sun className="w-3 h-3 text-amber-500" />
            <span>{t("settings.themeLight")}</span>
          </button>
          <button
            onClick={() => setTheme("dark")}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition ${
              theme === "dark"
                ? isLight
                  ? "bg-indigo-500/25 text-indigo-900 font-bold shadow-sm"
                  : "bg-indigo-500/30 text-indigo-200 font-semibold shadow-sm"
                : isLight
                ? "text-neutral-600 hover:text-neutral-900 font-medium"
                : "text-white/60 hover:text-white font-medium"
            }`}
          >
            <Moon className="w-3 h-3 text-indigo-500" />
            <span>{t("settings.themeDark")}</span>
          </button>
          <button
            onClick={() => setTheme("auto")}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-md transition ${
              theme === "auto"
                ? isLight
                  ? "bg-sky-500/25 text-sky-900 font-bold shadow-sm"
                  : "bg-sky-500/30 text-sky-200 font-semibold shadow-sm"
                : isLight
                ? "text-neutral-600 hover:text-neutral-900 font-medium"
                : "text-white/60 hover:text-white font-medium"
            }`}
          >
            <Laptop className="w-3 h-3 text-sky-500" />
            <span>{t("settings.themeAuto")}</span>
          </button>
        </div>
      </div>

      {/* 2. Inactivity Auto-collapse Timer */}
      <div className={`${
        isLight ? "bg-black/[0.04] border border-black/10" : "bg-white/5 border border-white/10"
      } rounded-xl p-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Timer className="w-4 h-4 text-amber-500" />
          <div className="flex flex-col">
            <span className="text-[11.5px] font-semibold">{t("settings.collapseTimer")}</span>
            <span className={`text-[9.5px] ${isLight ? "text-neutral-500" : "text-white/40"}`}>Inactivity timeout</span>
          </div>
        </div>

        <div className={`flex items-center p-0.5 rounded-lg text-[10.5px] gap-0.5 ${
          isLight ? "bg-black/10" : "bg-white/10"
        }`}>
          {[
            { sec: 30, labelKey: "settings.seconds30" },
            { sec: 60, labelKey: "settings.min1" },
            { sec: 180, labelKey: "settings.min3" },
            { sec: 300, labelKey: "settings.min5" },
            { sec: 0, labelKey: "settings.never" },
          ].map((item) => (
            <button
              key={item.sec}
              onClick={() => setCollapseTimeoutSeconds(item.sec)}
              className={`px-2 py-0.5 rounded-md transition text-[10px] ${
                collapseTimeoutSeconds === item.sec
                  ? isLight
                    ? "bg-amber-500/25 text-amber-900 font-bold shadow-sm"
                    : "bg-amber-500/30 text-amber-200 font-semibold shadow-sm"
                  : isLight
                  ? "text-neutral-600 hover:text-neutral-900 font-medium"
                  : "text-white/60 hover:text-white font-medium"
              }`}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* 3. Language Switcher */}
      <div className={`${
        isLight ? "bg-black/[0.04] border border-black/10" : "bg-white/5 border border-white/10"
      } rounded-xl p-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-sky-500" />
          <div className="flex flex-col">
            <span className="text-[11.5px] font-semibold">{t("common.language")}</span>
            <span className={`text-[9.5px] ${isLight ? "text-neutral-500" : "text-white/40"}`}>Русский / English</span>
          </div>
        </div>

        <div className={`flex items-center p-0.5 rounded-lg text-[10.5px] ${
          isLight ? "bg-black/10" : "bg-white/10"
        }`}>
          <button
            onClick={() => setLanguage("ru")}
            className={`px-2.5 py-0.5 rounded-md transition ${
              language === "ru"
                ? isLight
                  ? "bg-sky-500/25 text-sky-900 font-bold shadow-sm"
                  : "bg-sky-500/30 text-sky-200 font-semibold"
                : isLight
                ? "text-neutral-600 hover:text-neutral-900 font-medium"
                : "text-white/60 hover:text-white font-medium"
            }`}
          >
            RU
          </button>
          <button
            onClick={() => setLanguage("en")}
            className={`px-2.5 py-0.5 rounded-md transition ${
              language === "en"
                ? isLight
                  ? "bg-sky-500/25 text-sky-900 font-bold shadow-sm"
                  : "bg-sky-500/30 text-sky-200 font-semibold"
                : isLight
                ? "text-neutral-600 hover:text-neutral-900 font-medium"
                : "text-white/60 hover:text-white font-medium"
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* 4. Windows Autostart */}
      <div className={`${
        isLight ? "bg-black/[0.04] border border-black/10" : "bg-white/5 border border-white/10"
      } rounded-xl p-2.5 flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Power className="w-4 h-4 text-rose-500" />
          <div className="flex flex-col">
            <span className="text-[11.5px] font-semibold">{t("settings.autostart")}</span>
            <span className={`text-[9.5px] ${isLight ? "text-neutral-500" : "text-white/40"}`}>Windows Registry Run</span>
          </div>
        </div>

        <button
          onClick={() => setAutostart(!autostart)}
          className={`w-9 h-5 rounded-full transition-colors relative p-0.5 ${
            autostart
              ? "bg-emerald-500"
              : isLight
              ? "bg-black/20"
              : "bg-white/20"
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform ${
              autostart ? "translate-x-4" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {/* 5. Target Monitor Selector */}
      <div className={`${
        isLight ? "bg-black/[0.04] border border-black/10" : "bg-white/5 border border-white/10"
      } rounded-xl p-2.5 flex flex-col gap-1.5`}>
        <div className="flex items-center gap-2 mb-0.5">
          <Monitor className="w-4 h-4 text-purple-500" />
          <span className="text-[11.5px] font-semibold">{t("common.monitors")}</span>
        </div>

        <div className="space-y-1">
          {availableMonitors.length === 0 ? (
            <button
              onClick={() => handleSelectMonitor("primary")}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-between border ${
                isLight
                  ? "bg-purple-500/15 text-purple-900 border-purple-500/25 font-medium"
                  : "bg-purple-500/20 text-purple-200 border-purple-500/30"
              }`}
            >
              <span>{t("settings.primaryMonitor")} (1920x1080)</span>
              <Check className="w-3.5 h-3.5 text-purple-500" />
            </button>
          ) : (
            availableMonitors.map((m: MonitorInfo) => (
              <button
                key={m.id}
                onClick={() => handleSelectMonitor(m.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] flex items-center justify-between transition ${
                  selectedMonitor === m.id || (selectedMonitor === "primary" && m.isPrimary)
                    ? isLight
                      ? "bg-purple-500/15 text-purple-900 font-medium border border-purple-500/25"
                      : "bg-purple-500/20 text-purple-200 font-medium border border-purple-500/30"
                    : isLight
                    ? "text-neutral-700 hover:bg-black/5"
                    : "text-white/70 hover:bg-white/10"
                }`}
              >
                <span>
                  {m.name} ({m.width}x{m.height}) {m.isPrimary ? "• Primary" : ""}
                </span>
                {(selectedMonitor === m.id || (selectedMonitor === "primary" && m.isPrimary)) && (
                  <Check className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* 6. Panel Manager */}
      <div className={`${
        isLight ? "bg-black/[0.04] border border-black/10" : "bg-white/5 border border-white/10"
      } rounded-xl p-2.5 flex flex-col gap-1.5`}>
        <div className="flex items-center gap-2 mb-0.5">
          <Sliders className="w-4 h-4 text-emerald-500" />
          <span className="text-[11.5px] font-semibold">{t("settings.activePanels")}</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {pluginRegistry.map((p) => {
            const isEnabled = enabledTabs[p.id] !== false;
            const Icon = p.icon;

            return (
              <button
                key={p.id}
                onClick={() => toggleTab(p.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] border transition ${
                  isEnabled
                    ? isLight
                      ? "bg-black/[0.04] border-black/10 text-neutral-900 font-medium"
                      : "bg-white/10 border-white/20 text-white"
                    : isLight
                    ? "bg-black/[0.01] border-black/5 text-neutral-400"
                    : "bg-white/[0.02] border-white/5 text-white/30"
                }`}
              >
                <div className="flex items-center gap-1.5 truncate mr-1">
                  <Icon className="w-3 h-3 shrink-0" />
                  <span className="truncate">{t(p.nameKey, p.defaultLabel)}</span>
                </div>
                <div
                  className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    isEnabled ? "bg-emerald-500/30 border-emerald-500/50 text-emerald-300" : "border-white/20"
                  }`}
                >
                  {isEnabled && <Check className="w-2.5 h-2.5" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
