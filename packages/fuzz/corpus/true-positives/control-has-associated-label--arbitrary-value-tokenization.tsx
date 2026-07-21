// rule: control-has-associated-label
// weakness: arbitrary-value-tokenization
// source: 0.8.1-to-main all-rules parity review
// verdict: fail

export const FileInput = ({ fileInputRef }) => (
  <input className="[--state:x hidden y]" ref={fileInputRef} type="file" />
);
