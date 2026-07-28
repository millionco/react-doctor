import { useEffect } from "react";

const handleResize = () => {};
const resizeLifecycle = {
  install() {
    window.addEventListener("resize", handleResize);
  },
};

export const Sidebar = () => {
  useEffect(() => {
    resizeLifecycle.install();
  }, []);

  return null;
};
