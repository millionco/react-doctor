import { useEffect } from "react";

const handleClick = () => undefined;

interface CaptureListenerProperties {
  capture: boolean;
}

export const CaptureListener = ({ capture }: CaptureListenerProperties) => {
  useEffect(() => {
    window.addEventListener("click", handleClick, { capture });
    return () => window.removeEventListener("click", handleClick, { capture });
  }, [capture]);

  return null;
};
