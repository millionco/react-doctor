// rule: no-ref-current-in-render
// weakness: library-idiom
// source: react-bench GooeyToast oracle patch
import { useRef } from "react";

export const Player = () => {
  const playerRef = useRef(null);
  if (playerRef.current === null) playerRef.current = createPlayer();
  return null;
};
