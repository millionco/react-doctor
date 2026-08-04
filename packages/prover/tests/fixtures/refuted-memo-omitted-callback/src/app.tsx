import { memo } from "react";

interface ActionProperties {
  label: string;
  onRun: () => void;
}

const ActionView = ({ label, onRun }: ActionProperties) => (
  <button type="button" onClick={onRun}>
    {label}
  </button>
);

export const Action = memo(
  ActionView,
  (previousProperties, nextProperties) => previousProperties.label === nextProperties.label,
);
