import { useEffect } from "react";
import { TextureLoader } from "three";
import "@react-three/fiber";

export const Scene = ({ url }) => {
  useEffect(() => {
    new TextureLoader().load(url, setTexture);
  }, [url]);
  return <mesh />;
};
