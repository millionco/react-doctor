// rule: no-nested-card-surface
// weakness: static-value-guard
// source: bugbot-pr-850

export const FlatGroups = () => (
  <div className="rounded-xl border p-6">
    <section className="rounded-lg border-0 p-4">Zero border</section>
    <section className="rounded-lg shadow-none p-4">No shadow</section>
    <section className="rounded-lg ring-0 p-4">No ring</section>
  </div>
);
