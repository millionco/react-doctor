// rule: no-unguarded-browser-global-at-module-scope
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (Gatsby browser entry: `window.<prop> = …` expose-a-global bootstrap writes, not reads)
import { emitter } from "./emitter";
import { publicLoader } from "./loader";

window.___emitter = emitter;
window.___loader = publicLoader;

export {};
