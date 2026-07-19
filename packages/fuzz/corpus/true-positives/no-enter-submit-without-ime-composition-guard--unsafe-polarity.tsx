// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const Field = () => (
  <input
    onKeyDown={(event) => {
      if (event.key === "Enter" && event.nativeEvent.isComposing) submit();
    }}
  />
);
