// rule: no-nested-card-surface
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Panel = () => (
  <div className="rounded-xl border p-6">
    <section className="rounded-lg border border-0 p-4">Flat group</section>
  </div>
);
