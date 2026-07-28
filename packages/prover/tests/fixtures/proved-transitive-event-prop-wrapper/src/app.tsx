import { useState } from "react";

interface ActionButtonProperties {
  onActivate: () => void;
}

const ActionButton = (properties: ActionButtonProperties) => {
  const invokeAction = () => properties.onActivate();
  const handleClick = () => invokeAction();
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};

interface ApplicationProperties {
  usePrimaryAction: boolean;
}

export const Application = ({ usePrimaryAction }: ApplicationProperties) => {
  const [activationCount, setActivationCount] = useState(0);
  const recordPrimaryAction = () => setActivationCount((previousCount) => previousCount + 1);
  const recordSecondaryAction = () => setActivationCount(0);
  return (
    <section>
      <span>{activationCount}</span>
      <ActionButton onActivate={usePrimaryAction ? recordPrimaryAction : recordSecondaryAction} />
    </section>
  );
};
