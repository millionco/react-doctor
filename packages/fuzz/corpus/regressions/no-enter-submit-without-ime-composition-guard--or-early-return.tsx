// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: millionco/react-doctor#2440

export const Field = ({ onSubmit }) => {
  const handleKeyDown = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onSubmit();
    }
  };
  return <input onKeyDown={handleKeyDown} />;
};
