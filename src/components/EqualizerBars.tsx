import React from "react";
import { motion } from "framer-motion";

interface EqualizerBarsProps {
  isPlaying: boolean;
  className?: string;
}

export const EqualizerBars: React.FC<EqualizerBarsProps> = ({ isPlaying, className = "" }) => {
  // 4 bars with varied rhythms for natural-looking equalizer
  const bars = [
    { peaks: [3, 14, 4, 11, 3],  duration: 0.82, delay: 0.00 },
    { peaks: [3, 15, 6, 15, 3],  duration: 1.10, delay: 0.18 },
    { peaks: [3, 9,  3, 8,  3],  duration: 0.70, delay: 0.08 },
    { peaks: [3, 13, 5, 12, 3],  duration: 0.95, delay: 0.28 },
  ];

  return (
    <div
      className={`flex items-end gap-[2px] h-[15px] shrink-0 ${className}`}
      style={{ willChange: "transform" }}
    >
      {bars.map((bar, i) => (
        <motion.div
          key={i}
          className="w-[2.5px] rounded-full bg-gradient-to-t from-fuchsia-500 via-pink-400 to-rose-300 shadow-[0_0_6px_rgba(244,63,94,0.35)] block origin-bottom"
          initial={{ height: 3 }}
          animate={
            isPlaying
              ? { height: bar.peaks }
              : { height: 3 }
          }
          transition={
            isPlaying
              ? {
                  repeat: Infinity,
                  repeatType: "loop",
                  duration: bar.duration,
                  ease: [0.45, 0.05, 0.55, 0.95],
                  delay: bar.delay,
                  times: [0, 0.3, 0.5, 0.75, 1],
                }
              : {
                  type: "spring",
                  stiffness: 320,
                  damping: 28,
                }
          }
        />
      ))}
    </div>
  );
};
