import { useThree } from "@react-three/fiber/webgpu";

export const RendererConsumer = () => useThree((state) => state.gl);
