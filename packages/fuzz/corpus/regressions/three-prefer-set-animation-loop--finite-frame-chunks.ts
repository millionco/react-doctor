// rule: three-prefer-set-animation-loop
// verdict: pass
// weakness: control-flow
// source: thinky-3d tml-200-clay-park

const runBuildChunk = () => {
  while (stepIndex < steps.length && performance.now() < deadline) runStep();
  if (stepIndex < steps.length) {
    requestAnimationFrame(runBuildChunk);
    return;
  }
  finishBuild();
};

requestAnimationFrame(runBuildChunk);
