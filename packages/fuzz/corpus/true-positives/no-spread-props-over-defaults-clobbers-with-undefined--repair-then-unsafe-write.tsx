// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: control-flow
// source: PR #1000 final independent audit

interface Props {
  width?: number;
}

const defaults = { width: 1 };

export const RepairThenUnsafeWrite = (props: Props) => {
  const merged = { ...defaults, ...props };
  if (merged.width == null) merged.width = 1;
  merged.width = props.width;
  return merged.width * 2;
};
