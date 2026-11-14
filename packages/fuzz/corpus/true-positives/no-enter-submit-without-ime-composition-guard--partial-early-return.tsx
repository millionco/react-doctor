// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: millionco/react-doctor#2440

export const Field = ({ enabled, onSubmit }) => (
  <input
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing && enabled) return;
      if (event.key === "Enter") onSubmit();
    }}
  />
);
