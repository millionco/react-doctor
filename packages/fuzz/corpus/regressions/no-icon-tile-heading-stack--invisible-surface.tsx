// rule: no-icon-tile-heading-stack
// weakness: static-value-guard
// source: self-review

const SparklesIcon = () => <svg aria-hidden="true" />;

export const Feature = () => (
  <article className="rounded-xl border p-6">
    <div className="size-12 rounded-lg border-0 bg-transparent">
      <SparklesIcon />
    </div>
    <h3>Automations</h3>
  </article>
);
