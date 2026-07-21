// rule: no-arbitrary-px-font-size
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Label = ({ props }) => (
  <span className="text-[13px]" {...props}>
    Status
  </span>
);
