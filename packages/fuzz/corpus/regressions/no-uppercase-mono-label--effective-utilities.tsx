// rule: no-uppercase-mono-label
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Labels = () => (
  <>
    <span className="font-mono font-sans uppercase tracking-wide">System online</span>
    <span className="font-mono uppercase normal-case tracking-wide">System online</span>
    <span className="font-mono uppercase tracking-wide tracking-normal">System online</span>
  </>
);
