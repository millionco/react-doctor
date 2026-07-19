// rule: no-effect-chain
// weakness: provenance
// source: PR #1322 ship review

import { useEffect, useState } from "react";

declare global {
  var schedulerContainer: {
    setTimeout: (callback: () => void) => void;
  };
}

const {
  schedulerContainer: { setTimeout: schedule },
} = globalThis;
const { schedulerContainer: schedulerRoot } = globalThis;

interface NestedGlobalNamespaceDestructureProps {
  source: number;
}

export const NestedGlobalNamespaceDestructure = ({
  source,
}: NestedGlobalNamespaceDestructureProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    schedule(() => undefined);
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};

export const DestructuredGlobalObjectRoot = ({ source }: NestedGlobalNamespaceDestructureProps) => {
  const [intermediate, setIntermediate] = useState(source);
  const [target, setTarget] = useState(source);

  useEffect(() => setIntermediate(source), [source]);
  useEffect(() => {
    schedulerRoot.setTimeout(() => undefined);
    setTarget(intermediate);
  }, [intermediate]);

  return target;
};
