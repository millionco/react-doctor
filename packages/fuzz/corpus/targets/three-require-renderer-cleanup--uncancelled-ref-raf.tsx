// rule: three-require-renderer-cleanup
import { useEffect, useRef } from "react";
import { WebGLRenderer } from "three";

export const Scene = ({ canvas }) => {
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    const renderer = new WebGLRenderer({ canvas });
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();
    return () => renderer.dispose();
  }, [canvas]);
  return null;
};
