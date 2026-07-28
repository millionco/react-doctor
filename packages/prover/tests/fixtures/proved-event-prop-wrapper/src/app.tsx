interface ActionButtonProperties {
  onActivate: () => void;
}

const ActionButton = ({ onActivate }: ActionButtonProperties) => {
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
