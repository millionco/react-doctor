// rule: no-derived-state
// weakness: library-idiom
// source: independent synthetic matched SDK getter and event-payload regression
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
