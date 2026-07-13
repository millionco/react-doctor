// rule: react-hooks-js/set-state-in-effect
// weakness: library-idiom
// source: react-doctor#1233 (Jumper Exchange browser media capability synchronization)
import { useEffect, useState } from "react";

const video = document.createElement("video");

export const VideoBackground = ({ mime, videoKey }: { mime: string; videoKey: string }) => {
  const [playableVideoKey, setPlayableVideoKey] = useState<string | null>(null);

  useEffect(() => {
    setPlayableVideoKey(video.canPlayType(mime) !== "" ? videoKey : null);
  }, [mime, videoKey]);

  return playableVideoKey ? <video key={playableVideoKey} /> : null;
};
