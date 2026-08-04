interface ActionButtonProperties {
  onActivate: () => void;
}

const callbackKey = "onActivate" as const;

const ActionButton = ({ [callbackKey]: activate }: ActionButtonProperties) => {
  const handleClick = () => activate();
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
