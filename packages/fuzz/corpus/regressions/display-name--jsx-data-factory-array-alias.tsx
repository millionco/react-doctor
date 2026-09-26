// rule: display-name
// verdict: pass
// weakness: alias-guard
// source: adversarial descriptor control for PR #1821 validation F2

export const makeSections = () => () => {
  const element = <span>Icon</span>;
  const descriptor = { icon: element };
  const alias = descriptor;
  return [alias];
};
