// rule: no-small-form-control-text
// weakness: dynamic-computed
// source: 0.8.1-to-main all-rules parity audit
// verdict: pass

export const Search = ({ styles }) => <input className="text-xs" style={styles} />;
