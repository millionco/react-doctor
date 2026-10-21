// rule: effect-needs-cleanup
// verdict: fail
// weakness: cleanup-guard
// source: independently-synthetic
import { useEffect } from "react";
interface Emitter {
  on: (event: string, callback: () => void) => void;
  off: (event: string, callback: () => void) => void;
}
export const MutableReceiverPanel = ({
  first,
  fallback,
  other,
}: {
  first: Emitter;
  fallback: Emitter;
  other: Emitter;
}) => {
  let selected = first;
  useEffect(() => {
    const handler = () => {};
    const target = selected || fallback;
    target.on("data", handler);
    selected = other;
    return () => (selected || fallback).off("data", handler);
  }, [first, fallback, other]);
  return null;
};
