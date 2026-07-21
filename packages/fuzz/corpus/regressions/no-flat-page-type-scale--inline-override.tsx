// rule: no-flat-page-type-scale
// weakness: override-order
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const InlineTypeScale = () => (
  <main>
    <p className="text-sm" style={{ fontSize: 15 }}>
      Supporting copy
    </p>
    <h1 className="text-base">Page title</h1>
  </main>
);
