import { useEffect } from "react";

const handleResize = () => {};

const installResizeListener = () => {
  window.addEventListener("resize", handleResize);
};

const removeResizeListener = () => {
  window.removeEventListener("resize", handleResize);
};

interface SidebarProperties {
  isEnabled: boolean;
}

export const Sidebar = ({ isEnabled }: SidebarProperties) => {
  useEffect(() => {
    if (isEnabled) installResizeListener();
    return () => {
      removeResizeListener();
    };
  }, [isEnabled]);

  return null;
};
