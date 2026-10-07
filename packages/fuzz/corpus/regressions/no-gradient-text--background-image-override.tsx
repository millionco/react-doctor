// rule: no-gradient-text
// weakness: cascade-ambiguity
// source: 0.8.1 parity deep review
// verdict: pass

export const ImageFilledHeading = () => (
  <h1 className="text-transparent bg-clip-text bg-linear-to-r bg-[url('/hero.png')]">Title</h1>
);
