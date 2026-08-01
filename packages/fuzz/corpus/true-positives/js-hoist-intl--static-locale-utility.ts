// verdict: fail
// rule: js-hoist-intl
// weakness: framework-gating
// source: React Doctor adversarial control

export const formatAmount = (value: number) =>
  new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
