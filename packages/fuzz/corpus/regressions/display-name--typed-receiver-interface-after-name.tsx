// rule: display-name
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import { forwardRef } from "react";
interface DisplayTarget {
  displayName?: string;
}
export const Preview = forwardRef((_props, forwardedRef) => <div ref={forwardedRef} />);
(Preview as DisplayTarget).displayName = "Preview";
interface Preview {
  readonly tag: string;
}
