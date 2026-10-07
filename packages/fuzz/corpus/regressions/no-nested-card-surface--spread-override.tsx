// rule: no-nested-card-surface
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Panel = ({ props }) => (
  <div className="rounded-xl border p-6">
    <section className="rounded-lg border p-4" {...props}>
      Unknown inner surface
    </section>
  </div>
);
