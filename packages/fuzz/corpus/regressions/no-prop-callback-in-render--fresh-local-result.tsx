// rule: no-prop-callback-in-render
// weakness: alias-guard
// source: authored regression
const makePanelOperations = (_onSelect: () => void) => ({ prepare: () => 0 });

export const Panel = ({ onSelect }: { onSelect: () => void }) => {
  const { prepare } = makePanelOperations(onSelect);
  prepare();
  return <section />;
};
