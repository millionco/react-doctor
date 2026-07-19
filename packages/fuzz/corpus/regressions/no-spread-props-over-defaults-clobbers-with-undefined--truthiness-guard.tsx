// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: guard-polarity
// source: PR #1000 final precision review

const defaults = { width: 100 };

export const Panel = (props: { width?: number }) => {
  const merged = { ...defaults, ...props };
  return merged.width ? merged.width * 2 : 0;
};
