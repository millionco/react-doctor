// rule: html-label-has-single-control
// weakness: cross-file
// source: independently-authored-public-synthetic
// verdict: pass
// file-path: corpus/regressions/html-label-has-single-control--require-provider-escape.tsx
import { NativeAction } from "./html-label-has-single-control--polymorphic-button-helper";
const controls = require("./html-label-has-single-control--polymorphic-button-helper");
controls.NativeAction.defaultProps = { asChild: true };
export const Upload = () => (
  <label>
    <input />
    <NativeAction>
      <span>Pick</span>
    </NativeAction>
  </label>
);
