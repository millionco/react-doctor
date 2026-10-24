// rule: shadcn-icon-button-requires-label
// weakness: cross-file
// source: synthetic native button label transport
// verdict: pass
// file-path: corpus/regressions/native-button-label-forwarding/entry.tsx
import { Button } from "./button";

export const Toolbar = () => (
  <Button size="icon" accessibilityLabel="Expand panel">
    <svg />
  </Button>
);
