// rule: three-require-renderer-cleanup
// weakness: ref-path
// source: lifecycle review
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
    return () => {
      cancelAnimationFrame(frameRef.current);
      renderer.dispose();
    };
  }, [canvas]);
  return null;
};
