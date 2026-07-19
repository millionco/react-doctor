// rule: no-enter-submit-without-ime-composition-guard
// weakness: control-flow
// source: PR #1000 deep adversarial audit

export const Search = () => (
  <input
    onCompositionStart={() => logComposition()}
    onKeyDown={(event) => {
      if (event.key === "Enter") submitSearch();
    }}
  />
);
