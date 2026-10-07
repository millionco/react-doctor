// rule: no-hover-only-reveal
// weakness: decorative-content
// source: 0.8.1-to-main all-rules parity, ThriveX-Blog and Portofolio_V5
// verdict: pass

export const CardDecoration = () => (
  <article className="group">
    <div className="absolute inset-x-0 top-0 h-px opacity-0 group-hover:opacity-100" />
    <h2>Release notes</h2>
  </article>
);
