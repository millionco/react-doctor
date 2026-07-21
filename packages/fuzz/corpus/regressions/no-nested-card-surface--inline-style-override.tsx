// rule: no-nested-card-surface
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Panel = () => (
  <div className="rounded-xl border p-6">
    <section className="rounded-lg border p-4" style={{ border: "none" }}>
      Flat group
    </section>
  </div>
);
