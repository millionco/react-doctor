// rule: exhaustive-deps
// weakness: alias-guard
// verdict: safe
import { useCallback } from "react";

interface ActionProps {
  onCommit: (value: string) => void;
}

export const Action = ({ onCommit }: ActionProps) => {
  const actions = { ADD: "add" };
  return useCallback(() => onCommit(actions.ADD), [onCommit]);
};
