// rule: r3f-no-dispose-loader-cache
// weakness: import-provenance
// source: adversarial review
import { useGLTF } from "@react-three/drei";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

export const Scene = ({ url }: { url: string }) => {
  const model = useGLTF(url);
  const clone = SkeletonUtils.clone(model.scene);
  clone.children[0].material.dispose();
  return <primitive object={clone} />;
};
