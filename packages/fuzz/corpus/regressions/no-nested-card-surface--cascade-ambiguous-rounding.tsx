// rule: no-nested-card-surface
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const AmbiguousCard = () => (
  <div className="rounded-xl border p-6">
    <section className="rounded-none rounded-lg border p-4">Ambiguous inner</section>
  </div>
);
