// rule: no-unknown-property
// verdict: pass
// weakness: framework-gating
// source: Solid JSX type and native class variant of the pinned icon-check.tsx reproduction
import { type JSX as SolidJSX } from "solid-js";

export const Icon = (): SolidJSX.Element => <svg class="icon" />;
