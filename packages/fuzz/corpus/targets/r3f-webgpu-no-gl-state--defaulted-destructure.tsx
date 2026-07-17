import { useThree } from "@react-three/fiber/webgpu";

export const RendererConsumer = () =>
  useThree((state) => {
    const { gl = fallbackRenderer } = state;
    return gl;
  });
