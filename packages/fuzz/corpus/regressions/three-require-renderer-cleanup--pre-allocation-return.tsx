// rule: three-require-renderer-cleanup
// weakness: control-flow
// source: Daytona parity, icurtis1/thebrowserlab CameraPreviewPanel
import { useEffect, useRef } from "react";
import * as THREE from "three";

export const CameraPreviewPanel = ({ isVisible, mainScene }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvasRef.current || !isVisible) return;
    if (!mainScene) return;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasRef.current });
    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);
      renderer.render(mainScene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frameId);
      renderer.dispose();
    };
  }, [isVisible, mainScene]);
  return <canvas ref={canvasRef} />;
};
