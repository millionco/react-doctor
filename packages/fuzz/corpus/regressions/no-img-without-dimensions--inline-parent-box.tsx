// rule: no-img-without-dimensions
// weakness: wrapper-transparency
// source: CSS reserved-box contract audit after PR #1337 parity
// verdict: pass

export const Hero = () => (
  <div style={{ aspectRatio: "16 / 9" }}>
    <img src="/hero.jpg" alt="" />
  </div>
);
