// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: control-flow
// source: PR #1000 final adversarial audit

interface Props {
  width?: number;
}

const defaults = { width: 100 };

export const MemberWidth = (props: Props) => {
  const merged = { ...defaults, ...props };
  merged.width++;
  return merged.width.toFixed(2);
};
