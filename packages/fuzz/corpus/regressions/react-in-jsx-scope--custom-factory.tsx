// rule: react-in-jsx-scope
// weakness: library-idiom
// source: synthetic custom classic JSX factory
// verdict: pass
/** @jsx draw */
import { paint as draw } from "canvas-runtime";

export const CanvasPreview = () => (
  <article>
    <strong>Preview</strong>
  </article>
);
