// rule: no-unguarded-browser-global-in-render-or-hook-init
// weakness: alias-guard
// source: react-bench corpus audit 2026-07 (mezzanine: guard function whose body references a dom-guard-named module flag)
import { useElementRect } from "./use-element-rect";

const isSSR = typeof window === "undefined";
const isClientSide = () => !isSSR;

export function useBodyRect(options: object = {}) {
  return useElementRect({ ...options, element: isClientSide() ? document.body : null });
}
