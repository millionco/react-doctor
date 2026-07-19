// rule: rn-detox-missing-await
// weakness: name-heuristic
// source: adversarial audit 2026-07
const element = (selector: string) => ({ tap: () => selector });

export const runLocalAction = () => {
  element("submit").tap();
};
