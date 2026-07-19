// rule: r3f-no-dispose-loader-cache
import { useCubeTexture, useFBX, useFont, useKTX2 } from "@react-three/drei";

export const Scene = ({ files, fontUrl, modelUrl, path, textureUrl }) => {
  useCubeTexture(files, { path }).dispose();
  useFBX(modelUrl).geometry.dispose();
  useFont(fontUrl).data.dispose();
  useKTX2(textureUrl).dispose();
  return null;
};
