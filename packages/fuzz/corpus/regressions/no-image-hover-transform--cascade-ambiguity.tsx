// rule: no-image-hover-transform
// weakness: cascade-ambiguity
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const AmbiguousImage = () => (
  <img alt="Landscape" className="hover:scale-105 hover:scale-110" src="/photo.jpg" />
);

export const ResetImage = () => (
  <img alt="Landscape" className="hover:rotate-3 hover:!rotate-0" src="/photo.jpg" />
);
