import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Volume2, VolumeX, Mic, Check, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { useIslandStore, AudioDevice } from "../../store/useIslandStore";
import { useTranslation } from "../../core/i18n/useTranslation";

export const AudioWidget: React.FC = () => {
  const { t } = useTranslation();
  const audio = useIslandStore((s) => s.audio);
  const setAudio = useIslandStore((s) => s.setAudio);
  const setAudioAppVolume = useIslandStore((s) => s.setAudioAppVolume);
  const setAudioAppMute = useIslandStore((s) => s.setAudioAppMute);
  const refreshAudioAppSessions = useIslandStore((s) => s.refreshAudioAppSessions);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);
  const isLight = resolvedTheme === "light";
  const [showMixer, setShowMixer] = useState(false);

  useEffect(() => {
    refreshAudioAppSessions();
  }, [refreshAudioAppSessions]);

  useEffect(() => {
    if (showMixer) {
      refreshAudioAppSessions();
      const interval = setInterval(refreshAudioAppSessions, 2000);
      return () => clearInterval(interval);
    }
  }, [showMixer, refreshAudioAppSessions]);

  const handleSelectDevice = async (device: AudioDevice, isCapture: boolean) => {
    if (isCapture) {
      setAudio({
        captureDevices: audio.captureDevices.map((d) => ({
          ...d,
          isDefault: d.id === device.id,
        })),
      });
    } else {
      setAudio({
        renderDevices: audio.renderDevices.map((d) => ({
          ...d,
          isDefault: d.id === device.id,
        })),
      });
    }

    try {
      await invoke("audio_set_default_device", {
        deviceId: device.id,
        isCapture,
      });
    } catch {}
  };

  const handleVolumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setAudio({ masterVolume: val, isMuted: val === 0 });
    try {
      await invoke("audio_set_master_volume", { volume: val });
    } catch {}
  };

  const toggleMute = async () => {
    const newMuted = !audio.isMuted;
    setAudio({ isMuted: newMuted });
    try {
      await invoke("audio_set_mute", { muted: newMuted });
    } catch {}
  };

  return (
    <div className={`h-full flex flex-col gap-2.5 p-1 select-none ${
      isLight ? "text-neutral-900" : "text-white"
    }`}>
      {/* Master Volume Slider Row */}
      <div className={`rounded-xl p-2.5 flex items-center gap-2.5 shrink-0 border ${
        isLight ? "bg-black/[0.04] border-black/10" : "bg-white/5 border-white/10"
      }`}>
        <button
          onClick={toggleMute}
          className={`p-1 rounded-lg transition ${
            isLight ? "hover:bg-black/10 text-neutral-600 hover:text-neutral-900" : "hover:bg-white/10 text-white/70 hover:text-white"
          }`}
          title={audio.isMuted ? t("audio.unmute") : t("audio.mute")}
        >
          {audio.isMuted || audio.masterVolume === 0 ? (
            <VolumeX className="w-4 h-4 text-rose-500" />
          ) : (
            <Volume2 className="w-4 h-4 text-sky-500" />
          )}
        </button>

        <input
          type="range"
          min="0"
          max="100"
          value={audio.isMuted ? 0 : audio.masterVolume}
          onChange={handleVolumeChange}
          className={`flex-1 accent-sky-500 h-1.5 rounded-lg cursor-pointer ${
            isLight ? "bg-black/10" : "bg-white/15"
          }`}
        />

        <span className={`text-[11px] font-mono w-7 text-right ${
          isLight ? "text-neutral-600" : "text-white/70"
        }`}>
          {audio.isMuted ? "0%" : `${audio.masterVolume}%`}
        </span>

        {/* Mixer Toggle Button */}
        <button
          onClick={() => setShowMixer(!showMixer)}
          className={`p-1 rounded-lg transition flex items-center gap-0.5 text-[10px] ${
            showMixer
              ? isLight
                ? "bg-black/15 text-neutral-900 font-semibold"
                : "bg-white/15 text-white"
              : isLight
              ? "text-neutral-500 hover:text-neutral-900 hover:bg-black/5"
              : "text-white/50 hover:text-white hover:bg-white/10"
          }`}
          title={t("audio.appsMixer")}
        >
          <Layers className="w-3.5 h-3.5" />
          {showMixer ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {showMixer ? (
        /* App Volume Mixer */
        <div className={`flex-1 rounded-xl p-2.5 overflow-y-auto space-y-2 min-h-0 border ${
          isLight ? "bg-black/[0.03] border-black/10" : "bg-white/5 border-white/10"
        }`}>
          <div className={`flex items-center justify-between pb-1.5 border-b ${
            isLight ? "border-black/10" : "border-white/10"
          }`}>
            <span className={`text-[11px] font-semibold ${
              isLight ? "text-neutral-800" : "text-white/70"
            }`}>{t("audio.appsMixer")}</span>
            <span className={`text-[10px] ${
              isLight ? "text-neutral-500" : "text-white/40"
            }`}>
              {audio.appSessions?.length || 0} Active Sessions
            </span>
          </div>

          {/* Real App Mixer Items */}
          <div className="space-y-2 pt-1">
            {!audio.appSessions || audio.appSessions.length === 0 ? (
              <p className={`text-[10.5px] italic py-3 text-center ${
                isLight ? "text-neutral-400" : "text-white/35"
              }`}>
                {t("audio.noApps")}
              </p>
            ) : (
              audio.appSessions.map((app) => (
                <div key={app.id || app.pid} className="flex items-center gap-2 text-xs py-0.5">
                  <button
                    onClick={() => setAudioAppMute(app.pid, !app.isMuted)}
                    className={`p-1 rounded transition shrink-0 ${
                      isLight ? "hover:bg-black/10 text-neutral-600 hover:text-neutral-900" : "hover:bg-white/10 text-white/60 hover:text-white"
                    }`}
                    title={app.isMuted ? "Unmute" : "Mute"}
                  >
                    {app.isMuted || app.volume === 0 ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-500" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-sky-500" />
                    )}
                  </button>
                  <span className={`w-28 truncate text-[11px] font-medium ${
                    isLight ? "text-neutral-800" : "text-white/85"
                  }`} title={app.name}>
                    {app.name}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={app.isMuted ? 0 : app.volume}
                    onChange={(e) => setAudioAppVolume(app.pid, parseInt(e.target.value, 10))}
                    className={`flex-1 accent-sky-500 h-1.5 rounded-lg cursor-pointer ${
                      isLight ? "bg-black/10" : "bg-white/10"
                    }`}
                  />
                  <span className={`w-7 text-[10px] font-mono text-right ${
                    isLight ? "text-neutral-600" : "text-white/60"
                  }`}>
                    {app.isMuted ? "0%" : `${app.volume}%`}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Output & Input Device Selectors */
        <div className="grid grid-cols-2 gap-2 flex-1 min-h-0">
          {/* Output Devices */}
          <div className={`flex flex-col rounded-xl p-2 min-h-0 border ${
            isLight ? "bg-black/[0.04] border-black/10" : "bg-white/5 border-white/10"
          }`}>
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold mb-1 px-1 ${
              isLight ? "text-neutral-700" : "text-white/60"
            }`}>
              <Volume2 className="w-3 h-3 text-sky-500" />
              <span>{t("audio.output")}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {audio.renderDevices.length === 0 ? (
                <p className={`text-[10.5px] italic p-1 ${
                  isLight ? "text-neutral-400" : "text-white/30"
                }`}>No devices</p>
              ) : (
                audio.renderDevices.map((dev) => (
                  <button
                    key={dev.id}
                    onClick={() => handleSelectDevice(dev, false)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[10.5px] flex items-center justify-between transition-colors ${
                      dev.isDefault
                        ? isLight
                          ? "bg-sky-500/15 text-sky-900 font-semibold border border-sky-500/25"
                          : "bg-sky-500/20 text-sky-300 font-medium border border-sky-500/30"
                        : isLight
                        ? "text-neutral-700 hover:bg-black/5"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <span className="truncate mr-1">{dev.name}</span>
                    {dev.isDefault && <Check className="w-3 h-3 text-sky-500 shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Input Devices */}
          <div className={`flex flex-col rounded-xl p-2 min-h-0 border ${
            isLight ? "bg-black/[0.04] border-black/10" : "bg-white/5 border-white/10"
          }`}>
            <div className={`flex items-center gap-1.5 text-[11px] font-semibold mb-1 px-1 ${
              isLight ? "text-neutral-700" : "text-white/60"
            }`}>
              <Mic className="w-3 h-3 text-emerald-500" />
              <span>{t("audio.input")}</span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1">
              {audio.captureDevices.length === 0 ? (
                <p className={`text-[10.5px] italic p-1 ${
                  isLight ? "text-neutral-400" : "text-white/30"
                }`}>No devices</p>
              ) : (
                audio.captureDevices.map((dev) => (
                  <button
                    key={dev.id}
                    onClick={() => handleSelectDevice(dev, true)}
                    className={`w-full text-left px-2 py-1.5 rounded-lg text-[10.5px] flex items-center justify-between transition-colors ${
                      dev.isDefault
                        ? isLight
                          ? "bg-emerald-500/15 text-emerald-900 font-semibold border border-emerald-500/25"
                          : "bg-emerald-500/20 text-emerald-300 font-medium border border-emerald-500/30"
                        : isLight
                        ? "text-neutral-700 hover:bg-black/5"
                        : "text-white/70 hover:bg-white/10"
                    }`}
                  >
                    <span className="truncate mr-1">{dev.name}</span>
                    {dev.isDefault && <Check className="w-3 h-3 text-emerald-500 shrink-0" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
