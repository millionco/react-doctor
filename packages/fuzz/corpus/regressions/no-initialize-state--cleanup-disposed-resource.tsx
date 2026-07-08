// rule: no-initialize-state
// weakness: library-idiom
// source: adversarial edge-case hunt (mount effect seeding state from a resource its cleanup disposes)
import { useEffect, useState } from "react";

export const AudioNodeState = () => {
  const [gainNode, setGainNode] = useState<GainNode | null>(null);
  useEffect(() => {
    if (!gainNode) return;
    gainNode.gain.value = 0.5;
  }, [gainNode]);
  useEffect(() => {
    const audioContext = new AudioContext();
    setGainNode(audioContext.createGain());
    return () => {
      audioContext.close();
    };
  }, []);
  return null;
};
