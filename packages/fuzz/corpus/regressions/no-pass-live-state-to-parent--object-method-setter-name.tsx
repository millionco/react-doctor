// rule: no-pass-live-state-to-parent
// weakness: name-heuristic
// source: independently authored imperative device synchronization control
// verdict: pass

import { useEffect } from "react";

interface LevelDevice {
  setLevel: (level: number) => void;
}

export const useDeviceLevel = (device: LevelDevice, level: number) => {
  useEffect(() => {
    device.setLevel(level);
  }, [device, level]);
};
