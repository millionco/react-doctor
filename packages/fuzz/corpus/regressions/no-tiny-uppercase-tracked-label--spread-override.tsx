// rule: no-tiny-uppercase-tracked-label
// weakness: wrapper-transparency
// source: PR #1337 detector audit

const Label = ({ labelProps }) => (
  <span className="text-[0.625rem] uppercase tracking-wide" {...labelProps}>
    Recent activity
  </span>
);

export default Label;
