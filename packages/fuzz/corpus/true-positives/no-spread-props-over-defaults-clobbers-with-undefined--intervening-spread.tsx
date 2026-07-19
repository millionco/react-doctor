// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: spread-order
// source: PR #1000 final precision review

const defaults = { width: 100 };
const theme = { color: "red" };

export const Panel = (props: { width?: number }) => {
  const merged = { ...defaults, ...theme, ...props };
  return merged.width * 2;
};
