interface ActionButtonProperties {
  onActivate: () => void;
}

const ActionButton = ({ onActivate }: ActionButtonProperties) => (
  <button type="button" onClick={onActivate}>
    Activate
  </button>
);

const Toolbar = (properties: ActionButtonProperties) => <ActionButton {...properties} />;

export const Application = () => {
  const handleActivate = () => undefined;
  return <Toolbar onActivate={handleActivate} />;
};
