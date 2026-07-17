// rule: effect-needs-cleanup
// weakness: control-flow
// source: react-bench write-react-pedropalau-react-bnb rGxhkXn

import { useCallback } from "react";

export const useZoomPan = () => {
  const onMouseDown = useCallback(() => {
    const handleMouseMove = () => updatePosition();
    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, []);

  return { onMouseDown };
};
