import React, { useEffect } from "react";
import { IslandShell } from "./components/IslandShell";
import { useTauriEvents } from "./hooks/useTauriEvents";
import { useSingboxTraffic } from "./hooks/useSingboxTraffic";
import { useIslandStore } from "./store/useIslandStore";

export const App: React.FC = () => {
  // Initialize background event bus & metrics streams
  useTauriEvents();
  useSingboxTraffic();

  useEffect(() => {
    useIslandStore.getState().loadSettingsFromDisk();
  }, []);

  return (
    <main className="w-full h-full flex flex-col items-center justify-start select-none bg-transparent overflow-visible m-0 p-0">
      <IslandShell />
    </main>
  );
};

export default App;
