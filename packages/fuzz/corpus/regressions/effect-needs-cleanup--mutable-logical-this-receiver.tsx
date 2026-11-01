// rule: effect-needs-cleanup
// verdict: fail
// weakness: cleanup-guard
// source: independently-synthetic
import { useEffect } from "react";
interface Emitter {
  on: (event: string, callback: () => void) => void;
  off: (event: string, callback: () => void) => void;
}
interface Holder {
  first: Emitter | null;
  fallback: Emitter;
}
const useBoundEmitterSubscription = function (this: Holder, other: Emitter) {
  useEffect(() => {
    const handler = () => {};
    (this.first || this.fallback).on("data", handler);
    this.first = other;
    return () => (this.first || this.fallback).off("data", handler);
  }, [other]);
};
export const BoundEmitterPanel = ({ holder, other }: { holder: Holder; other: Emitter }) => {
  useBoundEmitterSubscription.call(holder, other);
  return null;
};
