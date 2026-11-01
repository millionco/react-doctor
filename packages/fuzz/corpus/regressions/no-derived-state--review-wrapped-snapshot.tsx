// rule: no-derived-state
// weakness: wrapper-transparency
// source: independent synthetic PR review regression
// verdict: pass
// file-path: corpus/regressions/no-derived-state--sdk-network-quality-snapshot-context/review-case.tsx
import { useEffect, useState } from "react";
import type { Participant as VideoPeer } from "twilio-video";
export const useSignalSnapshot = (remote: VideoPeer) => {
  const [score, setScore] = useState(remote.networkQualityLevel as number);
  useEffect(() => {
    const receiveScore = (sample: number) => setScore(sample);
    setScore(remote.networkQualityLevel as number);
    remote.on("networkQualityLevelChanged", receiveScore);
    return () => {
      remote.off("networkQualityLevelChanged", receiveScore);
    };
  }, [remote]);
  return score;
};
