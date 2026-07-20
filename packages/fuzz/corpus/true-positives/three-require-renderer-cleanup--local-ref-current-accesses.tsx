// rule: three-require-renderer-cleanup
// weakness: ownership-transfer
// source: Cursor Bugbot review
import { useEffect, useRef } from "react";
import { WebGLRenderer } from "three";

export const CameraPreview = ({ camera, canvas }) => {
  const rendererRef = useRef(null);
  useEffect(() => {
    if (rendererRef.current) return;
    const renderer = new WebGLRenderer({ canvas });
    rendererRef.current = renderer;
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [camera, canvas]);
  return null;
};
