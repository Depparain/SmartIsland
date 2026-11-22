import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Play, Pause, SkipBack, SkipForward, Music } from "lucide-react";
import { useIslandStore } from "../../store/useIslandStore";
import { useTranslation } from "../../core/i18n/useTranslation";

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
  }
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export const MediaWidget: React.FC = () => {
  const { t } = useTranslation();
  const media = useIslandStore((s) => s.media);
  const setMedia = useIslandStore((s) => s.setMedia);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);
  const isLight = resolvedTheme === "light";

  const handlePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setMedia({ isPlaying: !media.isPlaying });
    try {
      await invoke("media_play_pause");
    } catch {}
  };

  const handleNext = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("media_next");
    } catch {}
  };

  const handlePrev = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("media_prev");
    } catch {}
  };

  const progressPct =
    media.duration > 0
      ? Math.min(100, Math.max(0, (media.position / media.duration) * 100))
      : 0;

  return (
    <div className={`h-full flex flex-col justify-between py-1 px-2 select-none ${
      isLight ? "text-neutral-900" : "text-white"
    }`}>
      {/* Upper row: Album Art + Titles + Progress */}
      <div className="flex items-center gap-3.5">
        {/* Album Art Cover (68x68 px, ultra-clean) */}
        <div className={`relative w-[68px] h-[68px] rounded-xl overflow-hidden shrink-0 shadow-md ${
          isLight ? "bg-black/5 border border-black/10" : "bg-white/5 border border-white/10"
        }`}>
          {media.albumArt ? (
            <img
              src={media.albumArt}
              alt="Cover Art"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-pink-500 ${
              isLight ? "bg-black/[0.02]" : "bg-white/[0.03]"
            }`}>
              <Music className="w-6 h-6" />
            </div>
          )}
        </div>

        {/* Track details */}
        <div className="flex flex-col min-w-0 flex-1 justify-center">
          <h3 className={`text-[13px] font-semibold truncate leading-tight ${
            isLight ? "text-neutral-900" : "text-white/95"
          }`}>
            {media.title || t("media.noTrack")}
          </h3>
          <p className={`text-[11px] truncate mt-0.5 font-medium ${
            isLight ? "text-neutral-500" : "text-white/50"
          }`}>
            {media.artist || t("media.ready")}
          </p>

          {/* Progress Bar & Timestamps */}
          <div className="mt-2 flex items-center gap-2">
            <span className={`text-[9.5px] font-mono ${
              isLight ? "text-neutral-400" : "text-white/40"
            }`}>
              {formatTime(media.position)}
            </span>
            <div className={`flex-1 h-1 rounded-full overflow-hidden ${
              isLight ? "bg-black/10" : "bg-white/10"
            }`}>
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-400 rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className={`text-[9.5px] font-mono ${
              isLight ? "text-neutral-400" : "text-white/40"
            }`}>
              {formatTime(media.duration)}
            </span>
          </div>
        </div>
      </div>

      {/* Control Buttons Bar */}
      <div className={`flex items-center justify-center gap-6 mt-2 pt-2 border-t ${
        isLight ? "border-black/[0.08]" : "border-white/[0.06]"
      }`}>
        <button
          onClick={handlePrev}
          className={`p-2 rounded-full transition-all active:scale-95 ${
            isLight ? "text-neutral-600 hover:text-neutral-900 hover:bg-black/5" : "text-white/60 hover:text-white hover:bg-white/10"
          }`}
          title="Previous Track"
        >
          <SkipBack className="w-4 h-4 fill-current" />
        </button>

        <button
          onClick={handlePlayPause}
          className={`p-2.5 rounded-full transition-all shadow-md active:scale-95 flex items-center justify-center ${
            isLight
              ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-neutral-900/20"
              : "bg-white text-black hover:bg-white/90 shadow-white/20"
          }`}
          title={media.isPlaying ? "Pause" : "Play"}
        >
          {media.isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current ml-0.5" />
          )}
        </button>

        <button
          onClick={handleNext}
          className={`p-2 rounded-full transition-all active:scale-95 ${
            isLight ? "text-neutral-600 hover:text-neutral-900 hover:bg-black/5" : "text-white/60 hover:text-white hover:bg-white/10"
          }`}
          title="Next Track"
        >
          <SkipForward className="w-4 h-4 fill-current" />
        </button>
      </div>
    </div>
  );
};
