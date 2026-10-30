// fail: no-prop-callback-in-render
export const Panel = ({ onSave }) => {
  onSave();
  return <div />;
};
