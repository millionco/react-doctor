// rule: no-whole-object-default-losing-per-key-defaults
// weakness: wrapper-transparency
// source: React Bench audit of millionco/react-doctor#1000

interface TriggerOptions {
  renderTrigger: () => React.ReactNode;
}

const Trigger = (
  { renderTrigger }: TriggerOptions = {
    renderTrigger: () => <button type="button">Open</button>,
  },
) => <>{renderTrigger()}</>;

export const Example = () => <Trigger />;
