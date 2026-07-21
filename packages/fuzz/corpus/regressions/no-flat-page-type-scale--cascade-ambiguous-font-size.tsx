// rule: no-flat-page-type-scale
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const AmbiguousTypeScale = () => (
  <main>
    <p className="text-xs text-sm">Supporting copy</p>
    <h2 className="text-sm text-base">Section title</h2>
    <h1 className="text-base text-lg">Page title</h1>
  </main>
);
