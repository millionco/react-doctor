// rule: r3f-no-imperative-attach-of-managed-ref
// source: adversarial review
import "@react-three/fiber";
import { useRef } from "react";
import { Scene } from "three";

export const ModelPreview = () => {
  const previewRef = useRef<HTMLElement | null>(null);
  const scene = new Scene();
  scene.add(previewRef.current);
  return <model-preview ref={previewRef} />;
};
