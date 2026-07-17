import { useRenderPipeline } from "@react-three/fiber/webgpu";

export const Pipeline = () => {
  useRenderPipeline(({ passes }) => {
    passes.custom = customPass;
  });
  return null;
};
