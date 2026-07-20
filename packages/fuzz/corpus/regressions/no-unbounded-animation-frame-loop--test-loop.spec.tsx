// rule: no-unbounded-animation-frame-loop
// weakness: non-production-file
// source: PR #1337 all-rules RDE parity (aidenybai/react-grab)
export const installAnimationTestLoop = () => {
  const tick = () => {
    window.requestAnimationFrame(tick);
  };
  tick();
};
