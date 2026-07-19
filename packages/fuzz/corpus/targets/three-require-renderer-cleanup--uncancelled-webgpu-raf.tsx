// rule: three-require-renderer-cleanup
import { useEffect } from "react";
import { WebGPURenderer } from "three/webgpu";

export const Scene = ({ canvas }) => {
  useEffect(() => {
    const renderer = new WebGPURenderer({ canvas });
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.renderAsync(scene, camera);
    };
    animate();
    return () => renderer.dispose();
  }, [canvas]);
  return null;
};
