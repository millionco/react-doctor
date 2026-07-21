// rule: no-image-hover-transform
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: pass

export const Image = () => (
  <img alt="Landscape" className="[--effect:x group-hover:scale-105 fallback]" src="/photo.jpg" />
);
