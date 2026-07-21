// rule: no-cramped-container-padding
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const FlatLabel = () => (
  <div className="border p-1" style={{ border: "none" }}>
    Status
  </div>
);
