// rule: effect-raf-loop-needs-cancel
// weakness: control-flow
// source: PR #1365 deep audit

export const Animation = () => {
  useEffect(() => {
    let progress = 0;
    const loop = () => {
      progress -= 0.1;
      if (progress < 1) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }, []);
  return null;
};
