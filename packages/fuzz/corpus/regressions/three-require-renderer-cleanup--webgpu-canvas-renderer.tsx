// rule: three-require-renderer-cleanup
// source: Cursor Bugbot review on PR #1371
import { Canvas } from "@react-three/fiber/webgpu";
import { useMemo } from "react";
import { WebGPURenderer } from "three/webgpu";

export const Scene = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  const renderer = useMemo(() => new WebGPURenderer({ canvas }), [canvas]);
  return <Canvas renderer={renderer} />;
};
