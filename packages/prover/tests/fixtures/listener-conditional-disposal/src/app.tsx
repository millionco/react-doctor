import { useEffect } from "react";

const handleResize = () => undefined;

interface ResizeListenerProperties {
  shouldRemove: boolean;
}

export const ResizeListener = ({ shouldRemove }: ResizeListenerProperties) => {
  useEffect(() => {
    window.addEventListener("resize", handleResize);
    return () => {
      if (shouldRemove) window.removeEventListener("resize", handleResize);
    };
  }, [shouldRemove]);

  return null;
};
