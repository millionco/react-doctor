interface ActionButtonProperties {
  action: () => void;
}

const ActionButton = (properties: ActionButtonProperties) => (
  <button type="button" onClick={properties.action}>
    Run
  </button>
);

interface ToolbarProperties {
  onRun: () => void;
}

const Toolbar = ({ onRun }: ToolbarProperties) => <ActionButton action={onRun} />;

export const Application = () => {
  const recordRun = () => undefined;
  return <Toolbar onRun={recordRun} />;
};
