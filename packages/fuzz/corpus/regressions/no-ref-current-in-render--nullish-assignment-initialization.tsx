// rule: no-ref-current-in-render
// weakness: library-idiom
// source: react-bench AppFlowy oracle patch
import { useRef } from "react";

export const Player = () => {
  const playerRef = useRef(null);
  playerRef.current ??= createPlayer();
  return null;
};
