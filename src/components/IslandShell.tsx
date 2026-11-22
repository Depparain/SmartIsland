import React, { useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence, PanInfo } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { Music, Volume2, Bell, X, Box, Shield, ChevronDown } from "lucide-react";
import { useIslandStore, CollapsedWidgetType } from "../store/useIslandStore";
import { EqualizerBars } from "./EqualizerBars";
import { pluginRegistry, getPluginById, getDefaultPlugin } from "../core/plugins/registry";
import { useTranslation } from "../core/i18n/useTranslation";

// Apple-style spring slide variants for tab switching in expanded view (layout displacement)
const tabVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 36 : -36,
    opacity: 0,
    scale: 0.98,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 340,
      damping: 28,
      mass: 0.75,
      opacity: { duration: 0.18, ease: "easeOut" },
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -36 : 36,
    opacity: 0,
    scale: 0.98,
    transition: {
      type: "spring" as const,
      stiffness: 360,
      damping: 28,
      mass: 0.7,
      opacity: { duration: 0.14, ease: "easeIn" },
    },
  }),
};

// Collapsed carousel spring slide variants (push-out / displacement)
const collapsedContentVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 30 : -30,
    opacity: 0,
    scale: 0.96,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: {
      type: "spring" as const,
      stiffness: 360,
      damping: 26,
      mass: 0.65,
      opacity: { duration: 0.16, ease: "easeOut" },
    },
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -30 : 30,
    opacity: 0,
    scale: 0.96,
    transition: {
      type: "spring" as const,
      stiffness: 380,
      damping: 26,
      mass: 0.6,
      opacity: { duration: 0.12, ease: "easeIn" },
    },
  }),
};

const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const IslandShell: React.FC = () => {
  const { t } = useTranslation();
  const activeTab = useIslandStore((s) => s.activeTab);
  const setActiveTab = useIslandStore((s) => s.setActiveTab);
  const enabledTabs = useIslandStore((s) => s.enabledTabs);
  const tabsOrder = useIslandStore((s) => s.tabsOrder);
  const toastBanner = useIslandStore((s) => s.toastBanner);
  const setToastBanner = useIslandStore((s) => s.setToastBanner);
  const media = useIslandStore((s) => s.media);
  const setMedia = useIslandStore((s) => s.setMedia);
  const audio = useIslandStore((s) => s.audio);
  const collapseTimeoutSeconds = useIslandStore((s) => s.collapseTimeoutSeconds);
  const resolvedTheme = useIslandStore((s) => s.resolvedTheme);

  // Collapsed Carousel state & Temporary Override Notices
  const collapsedActiveWidget = useIslandStore((s) => s.collapsedActiveWidget);
  const cycleCollapsedWidget = useIslandStore((s) => s.cycleCollapsedWidget);
  const setCollapsedActiveWidget = useIslandStore((s) => s.setCollapsedActiveWidget);
  const tempOverrideNotice = useIslandStore((s) => s.tempOverrideNotice);
  const dismissCurrentNotice = useIslandStore((s) => s.dismissCurrentNotice);
  const dockerRunning = useIslandStore((s) => s.dockerRunning);
  const containers = useIslandStore((s) => s.containers);
  const vpnConnected = useIslandStore((s) => s.vpnConnected);
  const vpnMode = useIslandStore((s) => s.vpnMode);
  const vpnMetrics = useIslandStore((s) => s.vpnMetrics);

  const runningContainers = containers.filter((c) => c.state === "running").length;
  const failedContainers = containers.filter((c) => c.state === "exited" && c.status?.includes("Exited (")).length;

  // Hover state (auto-expands to full module panel on intentional hover)
  const [isHovered, setIsHovered] = useState<boolean>(false);
  // Collapsed state (ultra-thin line after timeout of no sound & no activity)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);

  // Directions
  const [direction, setDirection] = useState<number>(0);
  const [collapsedDirection, setCollapsedDirection] = useState<number>(0);

  // Timers and Throttle Refs
  const inactivityTimerRef = useRef<number | null>(null);
  const hoverGraceTimerRef = useRef<number | null>(null);
  const hoverIntentTimerRef = useRef<number | null>(null);
  const toastDismissTimerRef = useRef<number | null>(null);
  const tabHoverTimerRef = useRef<number | null>(null);
  const lastSwipeTimeRef = useRef<number>(0);
  const isDraggingRef = useRef<boolean>(false);
  const suppressExpandUntilRef = useRef<number>(0);

  // Pointer drag-scrolling for tabs bar
  const tabsScrollRef = useRef<{ isDown: boolean; startX: number; scrollLeft: number; hasMoved: boolean }>({
    isDown: false,
    startX: 0,
    scrollLeft: 0,
    hasMoved: false,
  });

  // Filter visible plugins according to tabsOrder & enabledTabs
  const visiblePlugins = React.useMemo(() => {
    const list: typeof pluginRegistry = [];
    for (const tabId of tabsOrder) {
      if (enabledTabs[tabId] !== false) {
        const found = getPluginById(tabId);
        if (found) list.push(found);
      }
    }
    for (const p of pluginRegistry) {
      if (!list.some((item) => item.id === p.id) && enabledTabs[p.id] !== false) {
        list.push(p);
      }
    }
    return list;
  }, [tabsOrder, enabledTabs]);

  const activePlugin = getPluginById(activeTab) || visiblePlugins[0] || getDefaultPlugin();
  const hasTrack = Boolean(media.title && media.title !== "No media active");
  const hasSound = media.isPlaying || Boolean(audio.isAudioActive);

  // Inactivity countdown
  const restartInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    if (collapseTimeoutSeconds <= 0) {
      return;
    }
    inactivityTimerRef.current = window.setTimeout(() => {
      setIsCollapsed(true);
    }, collapseTimeoutSeconds * 1000);
  }, [collapseTimeoutSeconds]);

  const cancelInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    restartInactivityTimer();
    return () => cancelInactivityTimer();
  }, [restartInactivityTimer, cancelInactivityTimer]);

  // Crisp auto-dismiss for toast banner to guarantee it never lingers
  useEffect(() => {
    if (toastBanner) {
      const timer = window.setTimeout(() => {
        setToastBanner(null);
      }, 3200);
      return () => clearTimeout(timer);
    }
  }, [toastBanner, setToastBanner]);

  // Synchronize physical window size with Rust backend
  const syncWindowSize = useCallback((w: number, h: number) => {
    invoke("set_window_size", { width: w, height: h }).catch(() => {});
  }, []);

  // Compute dimensions based on active state, activePlugin's defined size, and collapsed context
  const isThinLine = isCollapsed && !isHovered && !toastBanner && !tempOverrideNotice;

  let notchWidth = 360;
  let notchHeight = 32;

  if (isHovered) {
    // 1. Hovered: Auto-expands to active plugin's specific fixed dimensions
    notchWidth = activePlugin.dimensions.width;
    notchHeight = activePlugin.dimensions.height;
  } else if (tempOverrideNotice || toastBanner) {
    // 2. Incoming Notification / Temp Override: 380x44 px (prominent & readable)
    notchWidth = 380;
    notchHeight = 44;
  } else if (isThinLine) {
    // 3. Inactive timeout: Ultra-thin 3px line
    notchWidth = 200;
    notchHeight = 3;
  } else {
    // 4. Default active collapsed carousel:
    if (collapsedActiveWidget === "docker") {
      notchWidth = 340;
    } else if (collapsedActiveWidget === "vpn") {
      notchWidth = 320;
    } else {
      notchWidth = 370;
    }
    notchHeight = 32;
  }

  // Physical window dimensions (+24px width for Apple concave ears)
  const physicalWidth = notchWidth + 24;
  const physicalHeight = isThinLine ? 4 : notchHeight + 4;

  useEffect(() => {
    if (isThinLine) {
      // Delay shrinking physical window bounds until Framer Motion spring finishes shrinking
      const timer = window.setTimeout(() => {
        syncWindowSize(physicalWidth, physicalHeight);
      }, 260);
      return () => clearTimeout(timer);
    } else {
      // Instantly enlarge physical window so expanding animation has full bounds
      syncWindowSize(physicalWidth, physicalHeight);
    }
  }, [physicalWidth, physicalHeight, isThinLine, syncWindowSize]);

  const cancelHoverIntent = useCallback(() => {
    if (hoverIntentTimerRef.current) {
      clearTimeout(hoverIntentTimerRef.current);
      hoverIntentTimerRef.current = null;
    }
  }, []);

  const expandDrawer = useCallback(() => {
    cancelInactivityTimer();
    setIsCollapsed(false);
    if (toastBanner || tempOverrideNotice) {
      if (toastDismissTimerRef.current) {
        clearTimeout(toastDismissTimerRef.current);
        toastDismissTimerRef.current = null;
      }
    }
    syncWindowSize(activePlugin.dimensions.width + 24, activePlugin.dimensions.height + 4);
    setIsHovered(true);
  }, [activePlugin.dimensions, cancelInactivityTimer, syncWindowSize, tempOverrideNotice, toastBanner]);

  // Hover Intent delay (450ms) with interaction protection so swiping never accidentally expands
  const handleMouseEnter = () => {
    if (hoverGraceTimerRef.current) {
      clearTimeout(hoverGraceTimerRef.current);
      hoverGraceTimerRef.current = null;
    }

    cancelHoverIntent();

    // If currently in thin line mode, immediately wake up to 32px carousel notch!
    if (isThinLine) {
      setIsCollapsed(false);
      restartInactivityTimer();
      return;
    }

    hoverIntentTimerRef.current = window.setTimeout(() => {
      // If user was swiping or interacting with carousel, do NOT expand!
      if (Date.now() < suppressExpandUntilRef.current || isDraggingRef.current) {
        return;
      }
      expandDrawer();
    }, 450);
  };

  // Mouse Leave: cancel intent if cursor leaves early, or smoothly fold back with grace period
  const handleMouseLeave = () => {
    cancelHoverIntent();

    if (toastBanner || tempOverrideNotice) {
      if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);
      toastDismissTimerRef.current = window.setTimeout(() => {
        setToastBanner(null);
        dismissCurrentNotice();
        restartInactivityTimer();
      }, 1000);
    }

    hoverGraceTimerRef.current = window.setTimeout(() => {
      setIsHovered(false);
      restartInactivityTimer();
    }, 280);
  };

  const handleAnimationComplete = () => {
    // Sync physical window size after collapse spring completes so no visual clipping happens
    syncWindowSize(physicalWidth, physicalHeight);
  };

  const handlePlayPause = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDraggingRef.current) return;
    setMedia({ isPlaying: !media.isPlaying });
    try {
      await invoke("media_play_pause");
    } catch {}
  };

  // Switch tabs smoothly on pill hover
  const handleTabHover = (tabId: string) => {
    if (tabId === activeTab) return;
    if (tabHoverTimerRef.current) clearTimeout(tabHoverTimerRef.current);
    tabHoverTimerRef.current = window.setTimeout(() => {
      const currentIndex = visiblePlugins.findIndex((p) => p.id === activeTab);
      const targetIndex = visiblePlugins.findIndex((p) => p.id === tabId);
      setDirection(targetIndex > currentIndex ? 1 : -1);
      setActiveTab(tabId);
    }, 60);
  };

  const switchTab = (tabId: string) => {
    if (tabId === activeTab) return;
    const currentIndex = visiblePlugins.findIndex((p) => p.id === activeTab);
    const targetIndex = visiblePlugins.findIndex((p) => p.id === tabId);
    setDirection(targetIndex > currentIndex ? 1 : -1);
    setActiveTab(tabId);
  };

  // Cycle tabs via swipe gesture in expanded view with 300ms throttle
  const handleExpandedPanEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const now = Date.now();
    if (now - lastSwipeTimeRef.current < 280) return;

    const threshold = 30;
    const velocityThreshold = 180;
    const currentIndex = visiblePlugins.findIndex((p) => p.id === activeTab);
    if (currentIndex === -1 || visiblePlugins.length <= 1) return;

    if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
      lastSwipeTimeRef.current = now;
      const nextIndex = (currentIndex + 1) % visiblePlugins.length;
      setDirection(1);
      setActiveTab(visiblePlugins[nextIndex].id);
    } else if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      lastSwipeTimeRef.current = now;
      const prevIndex = (currentIndex - 1 + visiblePlugins.length) % visiblePlugins.length;
      setDirection(-1);
      setActiveTab(visiblePlugins[prevIndex].id);
    }
  };

  // Collapsed Carousel Swipe Gestures: Media -> Docker -> VPN (without expanding drawer)
  const handleCollapsedDragStart = () => {
    isDraggingRef.current = true;
    suppressExpandUntilRef.current = Date.now() + 1800;
    cancelHoverIntent();
  };

  const handleCollapsedDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    suppressExpandUntilRef.current = Date.now() + 1400;
    setTimeout(() => {
      isDraggingRef.current = false;
    }, 150);

    const now = Date.now();
    if (now - lastSwipeTimeRef.current < 240) return;

    const threshold = 18;
    const velocityThreshold = 80;

    if (info.offset.x < -threshold || info.velocity.x < -velocityThreshold) {
      lastSwipeTimeRef.current = now;
      setCollapsedDirection(1);
      cycleCollapsedWidget(1);
    } else if (info.offset.x > threshold || info.velocity.x > velocityThreshold) {
      lastSwipeTimeRef.current = now;
      setCollapsedDirection(-1);
      cycleCollapsedWidget(-1);
    }
  };

  const handleWheelCycle = (e: React.WheelEvent) => {
    const now = Date.now();
    if (now - lastSwipeTimeRef.current < 260) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(delta) > 15) {
      suppressExpandUntilRef.current = now + 1400;
      lastSwipeTimeRef.current = now;
      cancelHoverIntent();
      const dir = delta > 0 ? 1 : -1;
      setCollapsedDirection(dir);
      cycleCollapsedWidget(dir);
    }
  };

  const defaultDevice = audio.renderDevices?.find((d) => d.isDefault);
  const titleText = hasTrack
    ? media.title
    : hasSound
    ? "Sound Active"
    : "Smart Island";
  const artistText = hasTrack && media.artist
    ? media.artist
    : media.isPlaying
    ? (media.artist || "Windows Media")
    : hasSound
    ? (defaultDevice?.name || "Audio Output")
    : "Ready";

  const ActiveComponent = activePlugin.component;
  const isLight = resolvedTheme === "light";

  // Carousel items list for dots
  const carouselOrder: CollapsedWidgetType[] = ["media", "docker", "vpn"];

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="w-full h-full flex flex-col items-center justify-start select-none bg-transparent overflow-visible m-0 p-0"
    >
      <motion.div
        initial={false}
        animate={{
          width: notchWidth,
          height: notchHeight,
          borderBottomLeftRadius: isHovered ? 22 : isThinLine ? 0 : 16,
          borderBottomRightRadius: isHovered ? 22 : isThinLine ? 0 : 16,
        }}
        transition={{
          type: "spring",
          stiffness: 320,
          damping: 28,
          mass: 0.8,
          width: { type: "spring", stiffness: 300, damping: 28, mass: 0.8 },
          height: { type: "spring", stiffness: 340, damping: 30, mass: 0.75 },
          borderBottomLeftRadius: { type: "spring", stiffness: 320, damping: 28 },
          borderBottomRightRadius: { type: "spring", stiffness: 320, damping: 28 },
        }}
        onAnimationComplete={handleAnimationComplete}
        className={`relative flex flex-col justify-start select-none ${
          isThinLine
            ? "bg-transparent"
            : isLight
            ? "bg-[#f5f5f7] text-neutral-900"
            : "bg-black text-white"
        }`}
        style={{
          borderLeft: isHovered
            ? isLight
              ? "1px solid rgba(0, 0, 0, 0.08)"
              : "1px solid rgba(255, 255, 255, 0.12)"
            : "none",
          borderRight: isHovered
            ? isLight
              ? "1px solid rgba(0, 0, 0, 0.08)"
              : "1px solid rgba(255, 255, 255, 0.12)"
            : "none",
          borderBottom: isHovered
            ? isLight
              ? "1px solid rgba(0, 0, 0, 0.08)"
              : "1px solid rgba(255, 255, 255, 0.12)"
            : "none",
          borderTop: "none",
          borderTopLeftRadius: 0,
          borderTopRightRadius: 0,
          boxShadow: "none",
        }}
      >
        {/* Apple Concave Ears (visible when notch is in collapsed carousel state) */}
        {!isThinLine && !isHovered && (
          <>
            <svg
              className={`absolute top-0 -left-[10px] w-[10px] h-[10px] pointer-events-none ${
                isLight ? "fill-[#f5f5f7]" : "fill-black"
              }`}
              viewBox="0 0 10 10"
            >
              <path d="M 0 0 C 6 0 10 4 10 10 L 10 0 Z" />
            </svg>
            <svg
              className={`absolute top-0 -right-[10px] w-[10px] h-[10px] pointer-events-none ${
                isLight ? "fill-[#f5f5f7]" : "fill-black"
              }`}
              viewBox="0 0 10 10"
            >
              <path d="M 10 0 C 4 0 0 4 0 10 L 0 0 Z" />
            </svg>
          </>
        )}

        {/* 1. COLLAPSED STATE: Ultra-thin line at the very top edge */}
        {isThinLine ? (
          <div
            onClick={expandDrawer}
            className="w-full h-full flex items-center justify-center cursor-pointer"
          >
            <div
              className={`w-full h-[2px] rounded-full transition-all duration-300 ${
                hasSound
                  ? "bg-gradient-to-r from-purple-500/80 via-fuchsia-400 to-pink-500/80 shadow-[0_0_8px_rgba(236,72,153,0.5)]"
                  : isLight
                  ? "bg-black/30"
                  : "bg-white/25"
              }`}
            />
          </div>
        ) : isHovered ? (
          /* 2. HOVERED STATE: Full module panel with Apple Spring Physics */
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{
              opacity: { duration: 0.18, ease: "easeOut" },
              y: { type: "spring", stiffness: 380, damping: 30 },
            }}
            className="w-full h-full flex flex-col p-3"
          >
            {/* Header: Direct Navigation Tabs Bar with Touch/Pointer Drag & Hover */}
            <div className="flex items-center justify-between pb-2.5 shrink-0 w-full overflow-hidden">
              <div
                className="flex items-center gap-1.5 overflow-x-auto no-scrollbar w-full py-0.5 cursor-grab active:cursor-grabbing select-none"
                onWheel={(e) => {
                  e.currentTarget.scrollLeft += e.deltaY;
                }}
                onPointerDown={(e) => {
                  const container = e.currentTarget;
                  tabsScrollRef.current = {
                    isDown: true,
                    startX: e.pageX - container.offsetLeft,
                    scrollLeft: container.scrollLeft,
                    hasMoved: false,
                  };
                }}
                onPointerMove={(e) => {
                  if (!tabsScrollRef.current.isDown) return;
                  const container = e.currentTarget;
                  const x = e.pageX - container.offsetLeft;
                  const walk = (x - tabsScrollRef.current.startX) * 1.3;
                  if (Math.abs(walk) > 3) {
                    tabsScrollRef.current.hasMoved = true;
                  }
                  container.scrollLeft = tabsScrollRef.current.scrollLeft - walk;
                }}
                onPointerUp={() => {
                  tabsScrollRef.current.isDown = false;
                }}
                onPointerLeave={() => {
                  tabsScrollRef.current.isDown = false;
                }}
              >
                {visiblePlugins.map((plugin) => {
                  const Icon = plugin.icon;
                  const isActive = activeTab === plugin.id;
                  const isNotificationTab = plugin.id === "notifications" || plugin.id === "toasts";
                  const notifCount = useIslandStore.getState().notifications.length;

                  return (
                    <button
                      key={plugin.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (tabsScrollRef.current.hasMoved) return;
                        switchTab(plugin.id);
                      }}
                      onMouseEnter={() => handleTabHover(plugin.id)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all select-none ${
                        isActive
                          ? isLight
                            ? "bg-black/10 text-neutral-900 shadow-sm"
                            : "bg-white/20 text-white shadow-sm"
                          : isLight
                          ? "text-neutral-500 hover:text-neutral-900 hover:bg-black/5 font-medium"
                          : "text-white/60 hover:text-white/95 hover:bg-white/10 font-medium"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="whitespace-nowrap">{t(plugin.nameKey) || plugin.defaultLabel}</span>
                      {isNotificationTab && notifCount > 0 && (
                        <span className="ml-0.5 px-1.5 py-0.2 bg-sky-500/30 text-sky-400 text-[10px] rounded-full font-bold">
                          {notifCount}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* In-drawer Toast alert if new notification arrived while hovered */}
            {toastBanner && (
              <div
                className={`flex items-center justify-between px-3 py-1.5 my-1.5 border rounded-xl text-xs shrink-0 ${
                  isLight
                    ? "bg-sky-500/10 border-sky-500/25 text-sky-800"
                    : "bg-sky-500/15 border-sky-500/30 text-sky-200"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Bell className="w-3.5 h-3.5 text-sky-500 shrink-0 animate-pulse" />
                  <span className="font-semibold text-sky-600 uppercase text-[10px] tracking-wider">
                    {toastBanner.appName || "Notification"}:
                  </span>
                  <span className="truncate font-medium">
                    {toastBanner.title || toastBanner.body}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {activeTab !== "notifications" && activeTab !== "toasts" && (
                    <button
                      onClick={() => switchTab("notifications")}
                      className="text-[10px] bg-sky-500/30 hover:bg-sky-500/50 text-sky-200 px-2 py-0.5 rounded-md transition"
                    >
                      {t("notifications.clear")}
                    </button>
                  )}
                  <button
                    onClick={() => setToastBanner(null)}
                    className="p-0.5 opacity-50 hover:opacity-100"
                    title="Dismiss"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}

            {/* Modular Tab Content View with Physical Spring Displacement */}
            <div className="flex-1 min-h-0 pt-2 overflow-hidden relative">
              <AnimatePresence mode="wait" custom={direction}>
                <motion.div
                  key={activeTab}
                  custom={direction}
                  variants={tabVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.12}
                  onDragEnd={handleExpandedPanEnd}
                  className="w-full h-full cursor-grab active:cursor-grabbing overflow-hidden"
                >
                  <ActiveComponent />
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        ) : tempOverrideNotice ? (
          /* 3. TEMPORARY OVERRIDE NOTIFICATION STATE */
          <AnimatePresence mode="wait">
            <motion.div
              key={tempOverrideNotice.id}
              initial={{ opacity: 0, y: -6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              className="w-full h-full flex items-center justify-between px-3 gap-2.5 cursor-pointer select-none"
              onClick={() => {
                if (tempOverrideNotice.type === "toast") setActiveTab("notifications");
                else if (tempOverrideNotice.type === "docker") setActiveTab("docker");
                expandDrawer();
              }}
              title="Click to view details"
            >
              <div className="flex items-center gap-2 truncate">
                {tempOverrideNotice.type === "docker" ? (
                  <Box className="w-4 h-4 text-sky-400 shrink-0 animate-bounce" />
                ) : (
                  <Bell className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
                )}
                <span className="font-semibold text-[11.5px] truncate">
                  {tempOverrideNotice.title}:
                </span>
                <span className="truncate opacity-75 text-[11px] font-normal">
                  {tempOverrideNotice.subtitle}
                </span>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  dismissCurrentNotice();
                }}
                className="opacity-50 hover:opacity-100 p-0.5 rounded-full hover:bg-white/10 transition shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          </AnimatePresence>
        ) : toastBanner ? (
          /* 4. NOTIFICATION BANNER STATE: Clean toast notification banner (380x44 px) */
          <AnimatePresence mode="wait">
            <motion.div
              key={toastBanner.id || toastBanner.title}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="w-full h-full flex items-center justify-between px-3 gap-2.5 cursor-pointer"
              onClick={() => {
                setActiveTab("notifications");
                expandDrawer();
              }}
              title="Click to view notification details"
            >
              <div className="w-6 h-6 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0 border border-sky-500/35 shadow-[0_0_8px_rgba(56,189,248,0.3)]">
                <Bell className="w-3.5 h-3.5 animate-pulse" />
              </div>

              <div className="flex flex-col min-w-0 flex-1 justify-center">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">
                    {toastBanner.appName || "Notification"}
                  </span>
                  <span className="text-[9px] opacity-50">• just now</span>
                </div>
                <div className="flex items-baseline gap-1.5 truncate">
                  <span className="text-[11.5px] font-semibold truncate">
                    {toastBanner.title || "New alert"}
                  </span>
                  {toastBanner.body && (
                    <span className="text-[10px] opacity-65 truncate">
                      {toastBanner.body}
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (toastDismissTimerRef.current) clearTimeout(toastDismissTimerRef.current);
                  setToastBanner(null);
                  restartInactivityTimer();
                }}
                className="opacity-50 hover:opacity-100 p-1 rounded-full hover:bg-white/10 transition shrink-0"
                title="Dismiss"
              >
                <X className="w-3 h-3" />
              </button>
            </motion.div>
          </AnimatePresence>
        ) : (
          /* 5. COLLAPSED CAROUSEL STATE (Part 3): Media | Docker | VPN */
          <div
            onWheel={handleWheelCycle}
            onPointerDown={() => {
              suppressExpandUntilRef.current = Date.now() + 1400;
              cancelHoverIntent();
            }}
            onDoubleClick={expandDrawer}
            className="w-full h-full relative flex items-center justify-between px-2.5 select-none overflow-hidden cursor-grab active:cursor-grabbing"
          >
            {/* Top ambient track progress line (only for media) */}
            {collapsedActiveWidget === "media" && (
              <div className="absolute top-0 left-0 right-0 h-[1.5px] bg-white/[0.04] overflow-hidden pointer-events-none">
                {hasSound && (
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 via-fuchsia-400 to-pink-500 transition-all duration-300"
                    style={{
                      width: media.duration > 0 ? `${(media.position / media.duration) * 100}%` : "100%",
                    }}
                  />
                )}
              </div>
            )}

            <AnimatePresence mode="popLayout" custom={collapsedDirection}>
              {collapsedActiveWidget === "media" ? (
                /* Carousel Slide: Media */
                <motion.div
                  key="collapsed-media"
                  custom={collapsedDirection}
                  variants={collapsedContentVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.25}
                  onDragStart={handleCollapsedDragStart}
                  onDragEnd={handleCollapsedDragEnd}
                  onClick={handlePlayPause}
                  className="flex-1 min-w-0 h-full flex items-center justify-between"
                >
                  {/* Left: Album Art Cover / Sound Icon */}
                  <div
                    className={`relative w-5 h-5 rounded-[4px] overflow-hidden shrink-0 border shadow-sm mr-2 ${
                      isLight ? "bg-black/5 border-black/10" : "bg-white/10 border-white/15"
                    }`}
                  >
                    {media.albumArt ? (
                      <img src={media.albumArt} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className={`w-full h-full flex items-center justify-center ${
                          isLight ? "text-purple-600 bg-purple-500/10" : "text-pink-400 bg-white/5"
                        }`}
                      >
                        {hasSound ? <Music className="w-2.5 h-2.5 animate-pulse" /> : <Volume2 className="w-2.5 h-2.5" />}
                      </div>
                    )}
                  </div>

                  {/* Center: Track Title — Artist */}
                  <div className="flex items-center min-w-0 flex-1 overflow-hidden pr-2">
                    <span className="font-medium text-[12px] truncate min-w-0 shrink">
                      {titleText}
                    </span>
                    {artistText && (
                      <>
                        <span className="opacity-40 text-[10px] mx-1.5 shrink-0">—</span>
                        <span className="opacity-70 font-normal text-[11px] truncate min-w-0 shrink">
                          {artistText}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Right: Equalizer Bars */}
                  <div className="flex items-center gap-1.5 shrink-0 mr-1.5">
                    <EqualizerBars isPlaying={hasSound} />
                  </div>
                </motion.div>
              ) : collapsedActiveWidget === "docker" ? (
                /* Carousel Slide: Docker */
                <motion.div
                  key="collapsed-docker"
                  custom={collapsedDirection}
                  variants={collapsedContentVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.25}
                  onDragStart={handleCollapsedDragStart}
                  onDragEnd={handleCollapsedDragEnd}
                  onClick={() => {
                    if (isDraggingRef.current) return;
                    setActiveTab("docker");
                    expandDrawer();
                  }}
                  className="flex-1 min-w-0 h-full flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                    <div className="w-5 h-5 rounded-[4px] bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
                      <Box className="w-3 h-3 text-sky-400" />
                    </div>
                    <span className="font-medium text-[12px] shrink-0">Docker:</span>
                    <span className="opacity-75 text-[11px] truncate min-w-0">
                      {dockerRunning
                        ? `${runningContainers} running${failedContainers > 0 ? `, ${failedContainers} failed` : ""}`
                        : "Engine off"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mr-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        dockerRunning
                          ? runningContainers > 0
                            ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse"
                            : "bg-sky-400"
                          : "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]"
                      }`}
                    />
                  </div>
                </motion.div>
              ) : (
                /* Carousel Slide: VPN */
                <motion.div
                  key="collapsed-vpn"
                  custom={collapsedDirection}
                  variants={collapsedContentVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.25}
                  onDragStart={handleCollapsedDragStart}
                  onDragEnd={handleCollapsedDragEnd}
                  onClick={() => {
                    if (isDraggingRef.current) return;
                    setActiveTab("vpn");
                    expandDrawer();
                  }}
                  className="flex-1 min-w-0 h-full flex items-center justify-between"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 truncate">
                    <div
                      className={`w-5 h-5 rounded-[4px] flex items-center justify-center shrink-0 border ${
                        vpnConnected
                          ? "bg-emerald-500/20 border-emerald-500/35 text-emerald-400"
                          : "bg-white/5 border-white/10 opacity-50"
                      }`}
                    >
                      <Shield className="w-3 h-3" />
                    </div>
                    <span className="font-medium text-[12px] shrink-0">VPN:</span>
                    <span className="opacity-75 text-[11px] truncate min-w-0">
                      {vpnConnected
                        ? `${vpnMode === "tun" ? "TUN" : "Proxy"} • ${
                            vpnMetrics.pingMs ? `${vpnMetrics.pingMs}ms` : formatBytes(vpnMetrics.downBytes)
                          }`
                        : "Disconnected"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mr-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        vpnConnected
                          ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse"
                          : "bg-white/30"
                      }`}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Subtle Carousel Dots Indicator & Expand Chevron on Right */}
            <div className="flex items-center gap-1 shrink-0 ml-1.5 pl-1 border-l border-white/10">
              <div className="flex items-center gap-0.5">
                {carouselOrder.map((w) => (
                  <button
                    key={w}
                    onClick={(e) => {
                      e.stopPropagation();
                      const currentIdx = carouselOrder.indexOf(collapsedActiveWidget);
                      const targetIdx = carouselOrder.indexOf(w);
                      setCollapsedDirection(targetIdx > currentIdx ? 1 : -1);
                      setCollapsedActiveWidget(w);
                    }}
                    className={`h-1 transition-all rounded-full ${
                      collapsedActiveWidget === w
                        ? isLight
                          ? "w-2.5 bg-neutral-800"
                          : "w-2.5 bg-sky-400 shadow-[0_0_4px_rgba(56,189,248,0.8)]"
                        : isLight
                        ? "w-1 bg-black/20 hover:bg-black/40"
                        : "w-1 bg-white/20 hover:bg-white/40"
                    }`}
                    title={w.toUpperCase()}
                  />
                ))}
              </div>

              {/* Dedicated Expand Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  expandDrawer();
                }}
                className={`p-0.5 rounded hover:bg-white/10 transition opacity-40 hover:opacity-100 ${
                  isLight ? "text-neutral-700" : "text-white"
                }`}
                title="Expand Island"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
