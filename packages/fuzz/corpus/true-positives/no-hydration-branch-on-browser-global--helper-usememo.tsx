// rule: no-hydration-branch-on-browser-global
// weakness: wrapper-transparency
// source: react-bench trial fT6Z4PE

"use client";

import { useMemo } from "react";

const isPlayableVideo = (mime: string) => {
  if (typeof document === "undefined") return false;
  return ["maybe", "probably"].includes(document.createElement("video").canPlayType(mime));
};

export const Background = ({ mime }: { mime: string }) => {
  const playable = useMemo(() => mime.startsWith("video/") && isPlayableVideo(mime), [mime]);
  return playable ? <video /> : <img alt="" />;
};
