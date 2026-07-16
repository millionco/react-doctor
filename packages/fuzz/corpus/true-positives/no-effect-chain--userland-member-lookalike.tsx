// rule: no-effect-chain
// weakness: name-heuristic
// source: PR #1322 callback-provenance review

import { useCallback, useEffect, useState } from "react";

interface UserlandMemberLookalikeProps {
  service: {
    post: (value: number) => number;
  };
  source: number;
}

export const UserlandMemberLookalike = ({ service, source }: UserlandMemberLookalikeProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);
  const derive = useCallback(() => service.post(intermediate), [intermediate, service]);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    derive();
    setTarget(intermediate);
  }, [derive, intermediate]);

  return target;
};
