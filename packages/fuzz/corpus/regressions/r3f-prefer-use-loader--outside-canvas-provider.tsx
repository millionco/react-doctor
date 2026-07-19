import { Canvas } from "@react-three/fiber";
import { useEffect } from "react";
import { TextureLoader } from "three";

export const Preview = ({ url }) => {
  useEffect(() => {
    new TextureLoader().load(url, setTexture);
  }, [url]);
  return (
    <Canvas>
      <mesh />
    </Canvas>
  );
};
