// rule: no-img-without-dimensions
// weakness: static-auto-value
// source: CSS reserved-box contract audit after PR #1337 parity
// verdict: fail

export const Hero = () => <img src="/hero.jpg" alt="" style={{ width: "auto", height: "auto" }} />;
