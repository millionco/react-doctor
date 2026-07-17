// rule: r3f-no-state-in-use-frame
// weakness: control-flow
// source: liltrendi/gitlantis@e52016fa and takram-design-engineering/three-geospatial@b012ad06
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const PreviousValueTransition = () => {
  const [tiles, setTiles] = useState<string[]>([]);
  useFrame(() => {
    const previousKeys = readPreviousKeys();
    const nextKeys = readNextKeys();
    if (previousKeys !== nextKeys) setTiles(generateTiles());
  });
  return tiles.length;
};

export const FrameErrorTransition = ({ callback }: { callback: () => void }) => {
  const [error, setError] = useState<unknown>(null);
  useFrame(() => {
    try {
      callback();
    } catch (caughtError) {
      setError(caughtError);
    }
  });
  return error ? null : null;
};
