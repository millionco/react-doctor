// rule: display-name
// verdict: fail
// weakness: alias-guard
// source: PR #1821 independent validation F2, comment 5746849926

export const createView = () => () => {
  const element = <span>Rendered</span>;
  return [element];
};
