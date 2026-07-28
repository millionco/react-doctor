import { useEffect } from "react";

const handleResize = () => undefined;

interface ResizeListenerProperties {
  shouldRemove: boolean;
}

export const ResizeListener = ({ shouldRemove }: ResizeListenerProperties) => {
  useEffect(() => {
    window.addEventListener("resize", handleResize);
    if (shouldRemove) {
      return () => window.removeEventListener("resize", handleResize);
    }
    return () => undefined;
  }, [shouldRemove]);

  return null;
};
