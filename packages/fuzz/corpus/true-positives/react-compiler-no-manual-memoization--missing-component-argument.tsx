// rule: react-compiler-no-manual-memoization
// weakness: paren-shape
// source: Synthetic native parity regression
import { memo } from "react";

export const Component = memo();
