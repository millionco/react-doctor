// rule: three-require-renderer-cleanup
import { useEffect, useRef } from "react";
import { WebGLRenderer } from "three";

export const CameraPreview = ({ camera, canvas }) => {
  const rendererRef = useRef(null);
  useEffect(() => {
    const renderer = new WebGLRenderer({ canvas });
    rendererRef.current = renderer;
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    return () => renderer.dispose();
  }, [camera, canvas]);
  return null;
};
