// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: guard-invalidation
// source: PR #1000 final precision review

const defaults = { width: 100 };

export const Panel = (props: { width?: number }) => {
  const merged = { ...defaults, ...props };
  if (merged.width) {
    merged.width = undefined;
    return merged.width * 2;
  }
  return 0;
};
