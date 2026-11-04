import React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Music, Bell, Volume2 } from "lucide-react";
import { useIslandStore } from "../store/useIslandStore";
import { EqualizerBars } from "./EqualizerBars";

interface IdleIndicatorsProps {
  isHovered: boolean;
  onExpandPanel?: () => void;
}

export const IdleIndicators: React.FC<IdleIndicatorsProps> = ({ isHovered, onExpandPanel }) => {
  const media = useIslandStore((s) => s.media);
  const setMedia = useIslandStore((s) => s.setMedia);
  const audio = useIslandStore((s) => s.audio);
  const toastBanner = useIslandStore((s) => s.toastBanner);
  const trackNotice = useIslandStore((s) => s.trackNotice);

  // If a toast notification banner is currently shown (AC 3.3)
  if (toastBanner) {
    return (
      <div className="w-full h-full flex items-center px-3.5 gap-2.5 overflow-hidden">
        <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
          <Bell className="w-3.5 h-3.5 animate-bounce" />
        </div>
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[11px] font-semibold text-white/90 truncate">
            {toastBanner.appName || "Notification"}
          </span>
          <span className="text-[10px] text-white/60 truncate">{toastBanner.title || toastBanner.body}</span>
        </div>
      </div>
    );
  }

  const handlePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (media.isPlaying) {
      setMedia({ isPlaying: false });
      try {
        await invoke("media_play_pause");
      } catch {}
    } else {
      setMedia({ isPlaying: true });
      try {
        await invoke("media_play_pause");
      } catch {}
    }
  };

  const hasSound = media.isPlaying || Boolean(audio.isAudioActive);
  const isWide = isHovered || trackNotice;

  // Case 1: No sound active and not hovered -> ultra minimal idle line
  if (!hasSound && !isHovered) {
    return (
      <div className="w-full h-full flex items-center justify-center px-2">
        <div className="w-5 h-[2px] rounded-full bg-white/20 transition-all hover:bg-white/40" />
      </div>
    );
  }

  // Case 2: No sound active, but hovered
  if (!hasSound && isHovered) {
    return (
      <div className="w-full h-full flex items-center justify-between px-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-4 h-4 rounded-[4px] bg-white/10 flex items-center justify-center text-white/40">
            <Volume2 className="w-2.5 h-2.5" />
          </div>
          <span className="text-[11px] text-white/60 font-medium truncate">No active sound</span>
        </div>
        {onExpandPanel && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onExpandPanel();
            }}
            className="text-[10px] text-white/40 hover:text-white/80 transition px-1"
          >
            open
          </button>
        )}
      </div>
    );
  }

  // Case 3: Sound IS active!
  // If NOT wide (not hovered, not trackNotice) -> Mini Notch (Image 1 reference)
  if (!isWide) {
    return (
      <div
        onClick={handlePlayPause}
        className="w-full h-full flex items-center justify-between px-2 cursor-pointer group"
        title={media.isPlaying ? `${media.title} — ${media.artist} (Click to pause)` : "System Audio Playing"}
      >
        {/* Album Art Cover or Sound Icon */}
        <div className="relative w-5 h-5 rounded-[4px] overflow-hidden bg-white/10 shrink-0 border border-white/15 shadow-sm group-hover:opacity-85 transition">
          {media.albumArt ? (
            <img src={media.albumArt} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/40 bg-white/5">
              {media.isPlaying ? (
                <Music className="w-2.5 h-2.5 text-pink-400" />
              ) : (
                <Volume2 className="w-2.5 h-2.5 text-pink-400" />
              )}
            </div>
          )}
        </div>

        {/* 4 Pink/Purple Gradient Equalizer Bars */}
        <EqualizerBars isPlaying={hasSound} className="mr-0.5" />
      </div>
    );
  }

  // Case 4: Sound active AND trackNotice -> Active Track Notch (Image 2 reference)
  const defaultDevice = audio.renderDevices?.find((d) => d.isDefault);
  const titleText = media.isPlaying ? (media.title || "Now Playing") : "Sound Active";
  const artistText = media.isPlaying ? (media.artist || "Windows Media") : (defaultDevice?.name || "Audio Output");

  return (
    <div
      onClick={handlePlayPause}
      className="w-full h-full flex items-center justify-between px-2.5 cursor-pointer group"
      title="Click to Play/Pause"
    >
      {/* Left: Album Art or Sound Icon */}
      <div className="relative w-5 h-5 rounded-[4px] overflow-hidden bg-white/10 shrink-0 border border-white/15 shadow-sm group-hover:scale-105 transition-transform mr-2">
        {media.albumArt ? (
          <img src={media.albumArt} alt="Cover" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-white/40 bg-white/5">
            {media.isPlaying ? (
              <Music className="w-2.5 h-2.5 text-pink-400" />
            ) : (
              <Volume2 className="w-2.5 h-2.5 text-pink-400" />
            )}
          </div>
        )}
      </div>

      {/* Center: Track Title — Artist */}
      <div className="flex items-center min-w-0 flex-1 overflow-hidden pr-2">
        <span className="text-white font-medium text-[11.5px] truncate">
          {titleText}
        </span>
        <span className="text-white/30 text-[10px] mx-1.5 shrink-0">—</span>
        <span className="text-white/60 font-normal text-[11px] truncate">
          {artistText}
        </span>
      </div>

      {/* Right: Equalizer Bars */}
      <div className="flex items-center gap-1.5 shrink-0">
        <EqualizerBars isPlaying={hasSound} />
      </div>
    </div>
  );
};
