// rule: html-label-has-single-control
// weakness: cross-file
// source: independently-authored-public-synthetic
// verdict: pass
import { Slot } from "@radix-ui/react-slot";
export const NativeAction = ({ asChild = false, ...props }) => {
  const Host = asChild ? Slot : "button";
  return <Host {...props} />;
};
