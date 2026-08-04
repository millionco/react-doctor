import { useEffect } from "react";

interface VisibilityListenerProperties {
  enabled: boolean;
}

export const VisibilityListener = ({ enabled }: VisibilityListenerProperties) => {
  useEffect(() => {
    if (enabled) {
      const handleVisibility = () => undefined;
      document.addEventListener("visibilitychange", handleVisibility);
      return () => document.removeEventListener("visibilitychange", handleVisibility);
    }
  }, [enabled]);

  return <p>{enabled ? "enabled" : "disabled"}</p>;
};
