import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bell, Trash2 } from "lucide-react";
import { useIslandStore } from "../../store/useIslandStore";
import { useTranslation } from "../../core/i18n/useTranslation";

export const ToastsWidget: React.FC = () => {
  const { t } = useTranslation();
  const notifications = useIslandStore((s) => s.notifications);
  const clearNotifications = useIslandStore((s) => s.clearNotifications);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);
  const isLight = resolvedTheme === "light";

  const handleClearAll = async () => {
    clearNotifications();
    try {
      await invoke("notifications_clear_all");
    } catch {}
  };

  return (
    <div className={`h-full flex flex-col p-1 select-none ${
      isLight ? "text-neutral-900" : "text-white"
    }`}>
      {/* Top action bar */}
      <div className={`flex items-center justify-between pb-1.5 border-b shrink-0 mb-1.5 ${
        isLight ? "border-black/10" : "border-white/10"
      }`}>
        <div className={`flex items-center gap-1.5 text-xs ${
          isLight ? "text-neutral-700" : "text-white/70"
        }`}>
          <Bell className="w-3.5 h-3.5 text-sky-500" />
          <span className="font-semibold">{t("toasts.title")} ({notifications.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => invoke("notifications_send_test").catch(() => {})}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] text-sky-500 hover:text-sky-600 hover:bg-sky-500/10 transition border border-sky-500/20 font-medium"
            title="Send test toast notification"
          >
            <span>{t("toasts.testToast")}</span>
          </button>
          {notifications.length > 0 && (
            <button
              onClick={handleClearAll}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] transition ${
                isLight ? "text-neutral-500 hover:text-rose-500 hover:bg-rose-500/10" : "text-white/50 hover:text-rose-400 hover:bg-rose-500/10"
              }`}
            >
              <Trash2 className="w-3 h-3" />
              <span>{t("common.clear")}</span>
            </button>
          )}
        </div>
      </div>

      {/* Notifications list */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0">
        {notifications.length === 0 ? (
          <div className={`h-full flex flex-col items-center justify-center text-xs py-8 ${
            isLight ? "text-neutral-400" : "text-white/30"
          }`}>
            <Bell className="w-5 h-5 mb-1.5 opacity-30" />
            <span>{t("toasts.empty")}</span>
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className={`border rounded-xl p-2 transition flex flex-col gap-0.5 ${
                isLight
                  ? "bg-black/[0.03] border-black/10 hover:bg-black/[0.06]"
                  : "bg-white/5 border-white/10 hover:bg-white/10"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-bold text-sky-500 uppercase tracking-wider">
                  {n.appName}
                </span>
                <span className={`text-[9px] ${
                  isLight ? "text-neutral-400" : "text-white/40"
                }`}>{n.timestamp}</span>
              </div>
              <h4 className={`text-[11.5px] font-semibold truncate ${
                isLight ? "text-neutral-900" : "text-white/95"
              }`}>{n.title}</h4>
              <p className={`text-[10.5px] line-clamp-2 ${
                isLight ? "text-neutral-600" : "text-white/70"
              }`}>{n.body}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
