// rule: r3f-prefer-use-loader
import "@react-three/fiber";
import { useEffect } from "react";
import { TextureLoader } from "three";

export const ModelPreview = ({ url }) => {
  useEffect(() => {
    new TextureLoader().load(url, setTexture);
  }, [url]);
  return <model-preview />;
};
