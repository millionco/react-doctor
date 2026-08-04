import { startTransition } from "react";

interface ActionButtonProperties {
  action: () => void;
}

export const ActionButton = ({ action }: ActionButtonProperties) => (
  <button type="button" onClick={() => startTransition(action)}>
    Run
  </button>
);
