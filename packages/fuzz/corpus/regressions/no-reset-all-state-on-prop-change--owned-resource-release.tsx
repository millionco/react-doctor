// verdict: pass
// rule: no-reset-all-state-on-prop-change
// weakness: resource-lifecycle
// source: React Bench OpenFlipbook and Glific

import { useCallback, useEffect, useRef, useState } from "react";

export const GeometryOverlay = ({ nodeId, status }) => {
  const [phase, setPhase] = useState("idle");
  const previousRef = useRef({ nodeId, status });
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const previous = previousRef.current;
    const didResourceChange = previous.nodeId !== nodeId || previous.status !== status;
    if (didResourceChange) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setPhase("idle");
    }
    previousRef.current = { nodeId, status };
  }, [nodeId, status]);

  return phase;
};

export const EvaluationList = ({ searchQuery }) => {
  const [pendingDownloads, setPendingDownloads] = useState<Record<string, boolean>>({});
  const requestsRef = useRef(new Map<string, AbortController>());
  const abortAllRequests = () => {
    requestsRef.current.forEach((controller) => controller.abort());
    requestsRef.current.clear();
  };

  useEffect(() => {
    if (!requestsRef.current.size) return;
    abortAllRequests();
    setPendingDownloads({});
  }, [searchQuery]);

  return Object.keys(pendingDownloads).length;
};

export const VersionedResource = ({ resourceId }) => {
  const [phase, setPhase] = useState("idle");
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current += 1;
    setPhase("idle");
  }, [resourceId]);

  return phase;
};

export const MemoizedCleanupResource = ({ resourceId }) => {
  const [phase, setPhase] = useState("idle");
  const controllerRef = useRef<AbortController | null>(null);
  const abortRequest = useCallback(() => controllerRef.current?.abort(), []);

  useEffect(() => {
    setPhase("idle");
    return () => abortRequest();
  }, [resourceId, abortRequest]);

  return phase;
};
