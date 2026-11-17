// rule: display-name
// weakness: wrapper-transparency
// source: synthetic
// verdict: pass
import { forwardRef } from "react";

interface DisplayTarget {
  displayName?: string;
}

export const Preview = forwardRef<HTMLDivElement>((_props, forwardedRef) => (
  <div ref={forwardedRef} />
));
(Preview as DisplayTarget).displayName = "Preview";
