// rule: no-small-form-control-text
// weakness: cascade-ambiguity
// source: adversarial parity review
// verdict: pass

export const Search = () => <input className="!text-base" style={{ fontSize: 12 }} />;
