// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: RDE pmndrs/drei@c9d3d0dc .storybook/stories/HTML.stories.tsx
import { useFrame, useThree } from "@react-three/fiber";
import { useState } from "react";

export const Scene = () => {
  const camera = useThree((state) => state.camera);
  const [zoomIn, setZoomIn] = useState(true);
  useFrame(() => {
    zoomIn ? (camera.zoom += 0.01) : (camera.zoom -= 0.01);
    if (camera.zoom > 3) {
      setZoomIn(false);
    } else if (camera.zoom < 1) {
      setZoomIn(true);
    }
  });
  return null;
};
