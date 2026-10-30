// rule: insecure-crypto-risk
// weakness: name-heuristic
// source: Synthetic erased-only Error binding and disjoint error prose
// verdict: pass
interface Error {
  note: string;
}
// oxfmt-ignore
class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }
