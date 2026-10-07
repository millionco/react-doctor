// rule: three-prefer-set-animation-loop
// weakness: framework-gating
// source: https://github.com/millionco/react-doctor/issues/1795
// verdict: pass
import { WebGLRenderer } from "three";
const renderer = new WebGLRenderer();
renderer.setSize(1, 1);
const context = canvas.getContext("2d");
const frame = () => {
  context.fillRect(0, 0, 1, 1);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
