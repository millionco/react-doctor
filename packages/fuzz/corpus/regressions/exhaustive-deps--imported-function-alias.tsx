// rule: exhaustive-deps
// weakness: alias-guard
// source: RD-FP-016 task-perfection addendum (Psysonic, 2026-07-11)
import { useEffect } from "react";
import { setConnectionStatus } from "./connection-status";

export const StatusPanel = ({ status }: { status: string }) => {
  const setStatus = setConnectionStatus;

  useEffect(() => {
    setStatus(status);
  }, [status]);

  return null;
};
