import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Play, Square, RotateCw, Loader2 } from "lucide-react";
import { useIslandStore, DockerContainer } from "../../store/useIslandStore";
import { useTranslation } from "../../core/i18n/useTranslation";

export const DockerWidget: React.FC = () => {
  const { t } = useTranslation();
  const dockerRunning = useIslandStore((s) => s.dockerRunning);
  const containers = useIslandStore((s) => s.containers);
  const dockerLoadingAction = useIslandStore((s) => s.dockerLoadingAction);
  const setContainerLoading = useIslandStore((s) => s.setContainerLoading);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);
  const isLight = resolvedTheme === "light";

  const handleAction = async (id: string, action: "start" | "stop" | "restart") => {
    setContainerLoading(id, action);
    try {
      await invoke(`docker_${action}`, { id });
    } catch {} finally {
      setTimeout(() => setContainerLoading(id, null), 800);
    }
  };

  return (
    <div className={`h-full flex flex-col p-1 select-none ${
      isLight ? "text-neutral-900" : "text-white"
    }`}>
      {/* Top Header */}
      <div className={`flex items-center justify-between pb-1.5 border-b shrink-0 mb-1.5 ${
        isLight ? "border-black/10" : "border-white/10"
      }`}>
        <div className={`flex items-center gap-1.5 text-xs ${
          isLight ? "text-neutral-700" : "text-white/70"
        }`}>
          <Box className="w-3.5 h-3.5 text-blue-500" />
          <span className="font-semibold">{t("docker.title")}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              dockerRunning ? "bg-emerald-500 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.5)]" : "bg-rose-500"
            }`}
          />
          <span className={`text-[10px] ${isLight ? "text-neutral-500" : "text-white/50"}`}>
            {dockerRunning ? t("common.running") : t("common.stopped")}
          </span>
        </div>
      </div>

      {/* Containers List */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 min-h-0">
        {!dockerRunning ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 text-xs py-8">
            <Box className="w-6 h-6 mb-1.5 opacity-30 text-blue-400" />
            <span>{t("docker.engineNotRunning")}</span>
            <span className="text-[10px] text-white/20 mt-0.5">Named Pipe: //./pipe/docker_engine</span>
          </div>
        ) : containers.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-white/30 text-xs py-8">
            <Box className="w-5 h-5 mb-1 opacity-30" />
            <span>{t("docker.noContainers")}</span>
          </div>
        ) : (
          containers.map((c: DockerContainer) => {
            const isLoading = Boolean(dockerLoadingAction[c.id]);
            const isUp = c.state === "running";

            return (
              <div
                key={c.id}
                className="bg-white/5 border border-white/10 rounded-xl p-2 flex items-center justify-between hover:bg-white/10 transition"
              >
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isUp ? "bg-emerald-400" : "bg-white/30"
                    }`}
                  />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11.5px] font-medium text-white/95 truncate">
                      {c.name.replace(/^\//, "")}
                    </span>
                    <span className="text-[9.5px] text-white/40 truncate">{c.image}</span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400 mr-1" />
                  ) : (
                    <>
                      {isUp ? (
                        <>
                          <button
                            onClick={() => handleAction(c.id, "restart")}
                            className="p-1 text-white/50 hover:text-white hover:bg-white/10 rounded transition"
                            title="Restart"
                          >
                            <RotateCw className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleAction(c.id, "stop")}
                            className="p-1 text-white/50 hover:text-rose-400 hover:bg-rose-500/10 rounded transition"
                            title="Stop"
                          >
                            <Square className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleAction(c.id, "start")}
                          className="p-1 text-white/50 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition"
                          title="Start"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
