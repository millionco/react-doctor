// rule: no-nested-card-surface
// weakness: library-idiom
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Panel = () => (
  <div className="rounded-xl border p-6">
    <Portal>
      <section className="rounded-lg border p-4">Dialog card</section>
    </Portal>
  </div>
);
