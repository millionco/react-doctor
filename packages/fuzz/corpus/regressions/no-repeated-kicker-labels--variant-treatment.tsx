// rule: no-repeated-kicker-labels
// weakness: variant-scope
// source: Bugbot review on PR #850

export const ResponsiveSectionLabels = () => (
  <main>
    <section>
      <p className="md:uppercase tracking-widest">Approach</p>
      <h2>How it works</h2>
    </section>
    <section>
      <p className="uppercase md:tracking-widest">Benefits</p>
      <h2>Why it helps</h2>
    </section>
    <section>
      <p className="dark:uppercase tracking-widest">Results</p>
      <h2>What changed</h2>
    </section>
  </main>
);
