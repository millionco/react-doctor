// rule: iframe-missing-sandbox
// weakness: alias-guard
// source: Synthetic shadowed React API policy regression
// verdict: pass
export const createLocalFrame = () => {
  const createElement = (tagName: string) => ({ tagName });
  return createElement("iframe");
};
