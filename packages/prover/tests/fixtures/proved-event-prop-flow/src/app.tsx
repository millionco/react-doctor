import { useState } from "react";

interface ActionButtonProperties {
  onActivate: () => void;
}

const ActionButton = ({ onActivate: handleActivate }: ActionButtonProperties) => (
  <button type="button" onClick={handleActivate}>
    Activate
  </button>
);

export const Counter = () => {
  const [count, setCount] = useState(0);
  const increment = () => setCount((previousCount) => previousCount + 1);
  return (
    <section>
      <span>{count}</span>
      <ActionButton onActivate={increment} />
    </section>
  );
};
