// rule: no-derived-state-effect
// weakness: library-idiom
// source: independent synthetic companion effect SDK snapshot regression
// verdict: pass
// file-path: corpus/regressions/no-derived-state--sdk-network-quality-snapshot-context/snapshot.tsx
import { useEffect, useState } from "react";
import type { Participant as VideoPeer } from "twilio-video";

export const useSignalSnapshot = (remote: VideoPeer) => {
  const [score, setScore] = useState(remote.networkQualityLevel);
  useEffect(() => {
    const receiveScore = (sample: number) => setScore(sample);
    setScore(remote.networkQualityLevel);
    remote.on("networkQualityLevelChanged", receiveScore);
    return () => {
      remote.off("networkQualityLevelChanged", receiveScore);
    };
  }, [remote]);
  return score;
};
