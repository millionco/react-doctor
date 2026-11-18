// rule: no-nonresizable-textarea
// weakness: mixed-style-evidence
// source: synthetic audit regression
export const Editor = () => (
  <textarea aria-label="Message" className="resize-none" style={{ fieldSizing: "content" }} />
);
