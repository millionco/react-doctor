import { useLocalNodes } from "@react-three/fiber/webgpu";

export const useColorNode = () =>
  useLocalNodes(({ uniforms }) => {
    return uniforms.mode.value && { colorNode: red };
  });
