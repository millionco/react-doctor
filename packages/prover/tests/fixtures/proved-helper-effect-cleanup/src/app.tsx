import { useEffect } from "react";

const handleResize = () => {};

const installResizeListener = () => {
  window.addEventListener("resize", handleResize);
};

const removeResizeListener = () => {
  window.removeEventListener("resize", handleResize);
};

export const Sidebar = () => {
  useEffect(() => {
    installResizeListener();
    return () => {
      removeResizeListener();
    };
  }, []);

  return null;
};
