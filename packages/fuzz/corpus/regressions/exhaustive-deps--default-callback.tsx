// rule: exhaustive-deps
// weakness: default-parameter
// source: minimized callback dependency omission

import { useEffect } from "react";

interface PanelProps {
  onChange?: () => void;
}

export const Panel = ({ onChange = () => {} }: PanelProps) => {
  useEffect(() => onChange(), []);
  return null;
};
