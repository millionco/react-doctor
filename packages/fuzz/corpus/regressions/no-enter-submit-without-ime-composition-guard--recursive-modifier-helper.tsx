// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: deep audit of millionco/react-doctor#1000

export const Field = () => {
  const requiresModifier = (): boolean => requiresModifier();
  return (
    <textarea
      onKeyDown={(event) => {
        if (event.key === "Enter" && requiresModifier()) save();
      }}
    />
  );
};
