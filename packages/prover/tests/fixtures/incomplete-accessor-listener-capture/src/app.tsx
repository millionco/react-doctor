import { useEffect } from "react";

const handleClick = () => undefined;

interface CaptureListenerProperties {
  shouldCapture: boolean;
}

export const CaptureListener = ({ shouldCapture }: CaptureListenerProperties) => {
  useEffect(() => {
    const options = {
      get capture() {
        return shouldCapture;
      },
    };
    window.addEventListener("click", handleClick, options);
    return () => window.removeEventListener("click", handleClick, false);
  }, [shouldCapture]);

  return null;
};
