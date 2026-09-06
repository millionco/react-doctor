// rule: no-hydration-branch-on-browser-global
// weakness: framework-gating
// source: synthetic native parity regression
import "react";

export const Preview = () => (typeof document === "undefined" ? <div /> : <section />);
