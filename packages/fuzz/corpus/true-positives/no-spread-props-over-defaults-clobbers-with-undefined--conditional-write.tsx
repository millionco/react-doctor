// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: control-flow
// source: PR #1000 final adversarial audit

interface Props {
  enabled: boolean;
  width?: number;
}

const defaults = { width: 100 };

export const ConditionalWidth = (props: Props) => {
  const merged = { ...defaults, ...props };
  if (props.enabled) merged.width = 100;
  return merged.width * 2;
};
