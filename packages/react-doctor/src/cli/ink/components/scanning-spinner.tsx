import { Text } from "ink";
import { TUI_SPINNER_FRAME_INTERVAL_MS, TUI_SPINNER_FRAMES } from "../../utils/constants.js";
import { useEffect, useState } from "../react-runtime.js";

export const ScanningSpinner = () => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setFrameIndex((currentFrameIndex) => (currentFrameIndex + 1) % TUI_SPINNER_FRAMES.length);
    }, TUI_SPINNER_FRAME_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, []);

  return <Text>{TUI_SPINNER_FRAMES[frameIndex]}</Text>;
};
