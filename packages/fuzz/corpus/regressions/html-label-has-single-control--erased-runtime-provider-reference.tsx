// rule: html-label-has-single-control
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: pass
// file-path: corpus/regressions/html-label-has-single-control--erased-runtime-provider-reference.tsx
import { NativeAction as Button } from "./html-label-has-single-control--polymorphic-button-helper";
import { mutate } from "./external";
function expose() {
  interface Button {}
  mutate(Button);
}
expose();
export const View = () => (
  <label>
    <input />
    <Button>
      <span>Pick</span>
    </Button>
  </label>
);
