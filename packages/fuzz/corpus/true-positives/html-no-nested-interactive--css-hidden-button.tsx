// rule: html-no-nested-interactive
// weakness: static-hiding-class
// source: 0.8.1-to-main all-rules parity
// verdict: fail

export const Card = () => (
  <button type="button" className="group">
    Open
    <button type="button" className="hidden group-hover:block">
      Delete
    </button>
  </button>
);
