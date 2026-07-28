import { useEffect } from "react";

interface ActionButtonProperties {
  onActivate: () => void;
}

const ActionButton = ({ onActivate }: ActionButtonProperties) => {
  useEffect(() => {
    onActivate();
  }, [onActivate]);
  const handleClick = () => onActivate();
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};

export const Application = () => {
  const recordActivation = () => undefined;
  return <ActionButton onActivate={recordActivation} />;
};
