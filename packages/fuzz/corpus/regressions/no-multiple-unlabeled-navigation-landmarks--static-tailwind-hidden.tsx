// rule: no-multiple-unlabeled-navigation-landmarks
// weakness: utility-cascade
// source: adversarial all-rules parity review
// verdict: pass

export const Navigation = () => (
  <main>
    <nav className="collapse">Collapsed</nav>
    <nav className="[display:none]">Display hidden</nav>
    <nav className="[visibility:hidden]">Visibility hidden</nav>
    <nav>Primary</nav>
  </main>
);
