// rule: no-cramped-container-padding
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Label = ({ props }) => (
  <div className="border p-1" {...props}>
    Status
  </div>
);
