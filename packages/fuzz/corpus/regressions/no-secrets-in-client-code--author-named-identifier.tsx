// rule: no-secrets-in-client-code
// weakness: name-heuristic
// source: fuzz FP hunt 2026-07 (twentyhq/twenty github-connector: `auth`
// matched inside AUTHORS — a component identifier UUID is not a credential)
export const TopPrAuthors = () => {
  return <div>Top PR authors</div>;
};

export const TOP_PR_AUTHORS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER =
  "a1d4f7e2-9b3c-4e8a-bf21-5d6c8a9b2e3f";
