// rule: iframe-missing-sandbox
// weakness: name-heuristic
// source: Synthetic erased-only global React binding
// verdict: fail
interface React {
  note: string;
}
React.createElement("iframe", null);
