interface ActionButtonProperties {
  onActivate: () => void;
}

const ActionButton = ({ onActivate }: ActionButtonProperties) => (
  <button type="button" onClick={onActivate}>
    Activate
  </button>
);

export const Toolbar = (properties: ActionButtonProperties) => <ActionButton {...properties} />;
