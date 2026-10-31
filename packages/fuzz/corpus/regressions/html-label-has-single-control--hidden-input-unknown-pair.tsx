// rule: html-label-has-single-control
// weakness: cross-file
// source: independently-authored-public-synthetic
// verdict: pass
// file-path: corpus/regressions/html-label-has-single-control--hidden-input-unknown-pair.tsx
import { NativeAction } from "./html-label-has-single-control--button-helper";
export const Upload = () => (
  <label>
    <input type="hidden" />
    <NativeAction>Pick</NativeAction>
  </label>
);
