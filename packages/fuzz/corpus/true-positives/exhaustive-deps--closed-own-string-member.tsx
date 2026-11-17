// rule: exhaustive-deps
// weakness: alias-guard
// verdict: fail
import { useCallback } from "react";

interface ActionProps {
  label: string;
  onCommit: (value: string) => void;
}

export const Action = ({ label, onCommit }: ActionProps) => {
  const actions = { ADD: label };
  return useCallback(() => onCommit(actions.ADD), [onCommit]);
};
