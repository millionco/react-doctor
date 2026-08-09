// rule: no-loading-flag-reset-outside-finally
// verdict: pass
// weakness: control-flow
// source: React Bench 0.9.6 exhaustive audit

import { useRef, useState } from "react";

export const OwnedCompletion = ({ save }) => {
  const [, setPending] = useState(false);
  const activeRequestRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const run = async () => {
    const requestId = ++requestSequenceRef.current;
    activeRequestRef.current = requestId;
    setPending(true);
    try {
      await save();
    } finally {
      if (activeRequestRef.current === requestId) setPending(false);
    }
  };
  return <button onClick={() => void run()}>Save</button>;
};

export const MirroredCompletion = ({ upload }) => {
  const [, setUploading] = useState(false);
  const run = async () => {
    setUploading(true);
    try {
      await upload();
      setUploading(false);
    } catch {
      setUploading(false);
    }
  };
  return <button onClick={() => void run()}>Upload</button>;
};
