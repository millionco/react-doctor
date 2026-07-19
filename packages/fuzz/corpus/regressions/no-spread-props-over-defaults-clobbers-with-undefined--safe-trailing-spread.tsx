// rule: no-spread-props-over-defaults-clobbers-with-undefined
// weakness: wrapper-transparency
// source: PR #1000 final independent audit

interface Props {
  width?: number;
}

const defaults = { width: 1 };
const finalValues = { width: 50 };

export const SafeTrailingSpread = (props: Props) => {
  const merged = { ...defaults, ...props, ...finalValues };
  return merged.width * 2;
};
