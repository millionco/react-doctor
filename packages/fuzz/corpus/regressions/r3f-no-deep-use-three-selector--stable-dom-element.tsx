import { useThree } from "@react-three/fiber";

export const CanvasConsumer = () => useThree((state) => state.gl.domElement);
