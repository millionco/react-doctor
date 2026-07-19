// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: control-flow
// source: PR #1000 final adversarial audit

interface Props {
  width?: number;
}

const defaults = { width: 100 };

export const Width = (props: Props) => {
  const merged = { ...defaults, ...props, ...defaults };
  return merged.width * 2;
};
