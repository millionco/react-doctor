// rule: html-label-has-single-control
// weakness: cross-file
// source: independently-authored-public-synthetic
// verdict: fail
// file-path: corpus/regressions/html-label-has-single-control--local-native-button.tsx
import { NativeAction } from "./html-label-has-single-control--button-helper";
export const Upload = () => (
  <label>
    <input type="file" />
    <NativeAction>Pick</NativeAction>
  </label>
);
