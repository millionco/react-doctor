// rule: no-ref-current-in-render
// weakness: alias-guard
// source: deep adversarial audit of PR #1175

import { useRef } from "react";

export const Player = () => {
  const playerRef = useRef<VideoPlayer | null>(null);
  const player = playerRef.current;
  if (player === null) playerRef.current = new VideoPlayer();
  return null;
};
