import React, { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield, ArrowDown, ArrowUp, Activity, Check, Key, Loader2, AlertCircle } from "lucide-react";
import { useIslandStore } from "../../store/useIslandStore";
import { useTranslation } from "../../core/i18n/useTranslation";

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export const VpnWidget: React.FC = () => {
  const { t } = useTranslation();
  const vpnConnected = useIslandStore((s) => s.vpnConnected);
  const setVpnConnected = useIslandStore((s) => s.setVpnConnected);
  const vpnMode = useIslandStore((s) => s.vpnMode);
  const setVpnMode = useIslandStore((s) => s.setVpnMode);
  const vpnUriKey = useIslandStore((s) => s.vpnUriKey);
  const setVpnUriKey = useIslandStore((s) => s.setVpnUriKey);
  const vpnMetrics = useIslandStore((s) => s.vpnMetrics);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);
  const isLight = resolvedTheme === "light";

  const [editingKey, setEditingKey] = useState(false);
  const [keyInput, setKeyInput] = useState(vpnUriKey || "");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleToggleVpn = async () => {
    setErrorMessage(null);
    const next = !vpnConnected;

    if (next && !vpnUriKey.trim()) {
      setKeyInput(vpnUriKey);
      setEditingKey(true);
      setErrorMessage("Вставьте ссылку на прокси (vless://, ss://, trojan:// и др.)");
      return;
    }

    setIsLoading(true);
    try {
      await invoke("vpn_toggle", {
        connect: next,
        mode: vpnMode,
        uriKey: vpnUriKey.trim(),
      });
      setVpnConnected(next);
    } catch (e: any) {
      setVpnConnected(false);
      setErrorMessage(typeof e === "string" ? e : (e?.message || "Ошибка подключения VPN"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveKey = async () => {
    const trimmed = keyInput.trim();
    setVpnUriKey(trimmed);
    setEditingKey(false);
    setErrorMessage(null);
    try {
      await invoke("vpn_save_config", { uri: trimmed });
    } catch {}
  };

  const handleModeChange = async (mode: "system-proxy" | "tun") => {
    setVpnMode(mode);
    if (vpnConnected) {
      // Re-apply if already connected
      setIsLoading(true);
      try {
        await invoke("vpn_toggle", {
          connect: true,
          mode,
          uriKey: vpnUriKey.trim(),
        });
      } catch (e: any) {
        setErrorMessage(typeof e === "string" ? e : "Ошибка переключения режима");
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className={`h-full flex flex-col justify-between p-1 select-none ${
      isLight ? "text-neutral-900" : "text-white"
    }`}>
      {/* Top Header & Connection Switch */}
      <div className={`flex items-center justify-between pb-1.5 border-b shrink-0 ${
        isLight ? "border-black/10" : "border-white/10"
      }`}>
        <div className={`flex items-center gap-1.5 text-xs ${
          isLight ? "text-neutral-700" : "text-white/70"
        }`}>
          <Shield className={`w-3.5 h-3.5 ${vpnConnected ? "text-emerald-500" : isLight ? "text-neutral-400" : "text-white/40"}`} />
          <span className="font-semibold">{t("vpn.title")}</span>
        </div>

        <button
          onClick={handleToggleVpn}
          disabled={isLoading}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition shadow-sm ${
            vpnConnected
              ? isLight
                ? "bg-emerald-500/15 text-emerald-800 border border-emerald-500/30"
                : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
              : isLight
              ? "bg-black/10 text-neutral-700 hover:text-neutral-900"
              : "bg-white/10 text-white/60 hover:text-white"
          } ${isLoading ? "opacity-60 cursor-wait" : ""}`}
        >
          {isLoading ? (
            <Loader2 className="w-2.5 h-2.5 animate-spin text-emerald-400" />
          ) : (
            <span className={`w-1.5 h-1.5 rounded-full ${vpnConnected ? "bg-emerald-500 animate-ping" : isLight ? "bg-black/40" : "bg-white/40"}`} />
          )}
          <span>{vpnConnected ? t("common.connected") : t("common.disconnected")}</span>
        </button>
      </div>

      {/* Mode Selector & Config Key Button */}
      <div className="flex items-center justify-between gap-2 my-1">
        <div className={`flex items-center gap-1 border rounded-lg p-0.5 text-[10.5px] ${
          isLight ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10"
        }`}>
          <button
            onClick={() => handleModeChange("system-proxy")}
            title="Системный прокси (работает сразу без прав администратора)"
            className={`px-2 py-0.5 rounded-md transition ${
              vpnMode === "system-proxy"
                ? isLight
                  ? "bg-white text-neutral-900 shadow-sm font-semibold"
                  : "bg-white/20 text-white font-medium"
                : isLight
                ? "text-neutral-500 hover:text-neutral-800"
                : "text-white/50 hover:text-white"
            }`}
          >
            {t("vpn.modeSystem")}
          </button>
          <button
            onClick={() => handleModeChange("tun")}
            title="TUN Режим (создает сетевой интерфейс, требует запуска от имени администратора)"
            className={`px-2 py-0.5 rounded-md transition ${
              vpnMode === "tun"
                ? isLight
                  ? "bg-white text-neutral-900 shadow-sm font-semibold"
                  : "bg-white/20 text-white font-medium"
                : isLight
                ? "text-neutral-500 hover:text-neutral-800"
                : "text-white/50 hover:text-white"
            }`}
          >
            {t("vpn.modeTun")}
          </button>
        </div>

        <button
          onClick={() => {
            if (!editingKey) setKeyInput(vpnUriKey);
            setEditingKey(!editingKey);
          }}
          className={`text-[10px] flex items-center gap-1 px-2 py-1 rounded transition border ${
            vpnUriKey
              ? isLight
                ? "bg-black/5 border-black/10 text-neutral-700 hover:bg-black/10"
                : "bg-white/10 border-white/10 text-white/80 hover:bg-white/15"
              : "bg-amber-500/20 border-amber-500/30 text-amber-300 animate-pulse"
          }`}
        >
          <Key className="w-3 h-3" />
          <span>{vpnUriKey ? "Изменить URI" : "Добавить URI"}</span>
        </button>
      </div>

      {/* Editing Key Drawer */}
      {editingKey && (
        <div className={`flex items-center gap-1.5 mb-1 p-1.5 border rounded-lg shrink-0 ${
          isLight ? "bg-black/[0.03] border-black/10" : "bg-white/5 border-white/10"
        }`}>
          <input
            type="text"
            placeholder="vless://, vmess://, ss://, trojan://..."
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveKey();
              if (e.key === "Escape") setEditingKey(false);
            }}
            className={`flex-1 bg-transparent text-[11px] outline-none ${
              isLight ? "text-neutral-900 placeholder:text-neutral-400" : "text-white placeholder:text-white/30"
            }`}
            autoFocus
          />
          <button
            onClick={handleSaveKey}
            className="px-2 py-1 bg-emerald-500/30 hover:bg-emerald-500/50 text-emerald-300 rounded text-[10px] flex items-center gap-0.5 transition"
          >
            <Check className="w-3 h-3" />
            <span>{t("common.save")}</span>
          </button>
        </div>
      )}

      {/* Error Message Box */}
      {errorMessage && (
        <div className="flex items-start justify-between gap-1.5 p-1.5 px-2 bg-rose-500/20 border border-rose-500/35 rounded-lg text-rose-300 text-[10px] mb-1 leading-snug">
          <div className="flex items-start gap-1.5 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rose-400" />
            <span className="break-words">{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="opacity-50 hover:opacity-100 p-0.5 hover:bg-rose-500/30 rounded shrink-0"
            title="Скрыть"
          >
            ✕
          </button>
        </div>
      )}

      {/* Traffic Metrics Dashboard */}
      <div className={`grid grid-cols-3 gap-2 border rounded-xl p-2 text-center ${
        isLight ? "bg-black/[0.03] border-black/10" : "bg-white/5 border-white/10"
      }`}>
        <div className="flex flex-col items-center">
          <div className={`flex items-center gap-1 text-[9.5px] mb-0.5 ${
            isLight ? "text-neutral-500" : "text-white/40"
          }`}>
            <ArrowDown className="w-2.5 h-2.5 text-sky-400" />
            <span>Down</span>
          </div>
          <span className={`text-[11px] font-mono font-medium ${
            isLight ? "text-neutral-800" : "text-white/90"
          }`}>
            {formatBytes(vpnMetrics.downBytes)}
          </span>
        </div>

        <div className={`flex flex-col items-center border-x px-1 ${
          isLight ? "border-black/10" : "border-white/10"
        }`}>
          <div className={`flex items-center gap-1 text-[9.5px] mb-0.5 ${
            isLight ? "text-neutral-500" : "text-white/40"
          }`}>
            <ArrowUp className="w-2.5 h-2.5 text-emerald-400" />
            <span>Up</span>
          </div>
          <span className={`text-[11px] font-mono font-medium ${
            isLight ? "text-neutral-800" : "text-white/90"
          }`}>
            {formatBytes(vpnMetrics.upBytes)}
          </span>
        </div>

        <div className="flex flex-col items-center">
          <div className={`flex items-center gap-1 text-[9.5px] mb-0.5 ${
            isLight ? "text-neutral-500" : "text-white/40"
          }`}>
            <Activity className="w-2.5 h-2.5 text-amber-400" />
            <span>Ping</span>
          </div>
          <span className={`text-[11px] font-mono font-medium ${
            isLight ? "text-neutral-800" : "text-white/90"
          }`}>
            {vpnMetrics.pingMs > 0 ? `${vpnMetrics.pingMs} ms` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
};
