// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: PR #1000 deep adversarial audit

export const Search = ({ isComposing }: { isComposing: boolean }) => {
  const commit = () => {
    submitSearch();
    if (isComposing) return;
  };
  return <input onKeyDown={(event) => event.key === "Enter" && commit()} />;
};
