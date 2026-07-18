// rule: no-dynamic-tailwind-class-fragment
// weakness: wrapper-transparency
// source: PR #1337 detector audit

const Surface = ({ color, surfaceProps }) => (
  <div className={`bg-${color}-500`} {...surfaceProps} />
);

export default Surface;
