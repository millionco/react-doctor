// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: control-flow
// source: PR #1000 deep precision review

interface Props {
  width?: number;
}

const defaults = { width: 100 };

export const Panel = (props: Props) => {
  const merged = { ...defaults, ...props };
  return merged.width * 2;
};
