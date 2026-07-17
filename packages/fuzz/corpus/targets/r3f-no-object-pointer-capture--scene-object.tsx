import { Canvas } from "@react-three/fiber";

export const PointerScene = () => (
  <line onPointerDown={(event) => event.object.setPointerCapture(event.pointerId)} />
);

void Canvas;
