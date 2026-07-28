import { useEffect } from "react";

const handleResize = () => {};

const installResizeListener = () => {
  window.addEventListener("resize", handleResize);
};

export const Sidebar = () => {
  useEffect(() => {
    installResizeListener();
  }, []);

  return null;
};
