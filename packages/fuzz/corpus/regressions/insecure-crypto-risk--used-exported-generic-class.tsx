// rule: insecure-crypto-risk
// weakness: name-heuristic
// source: Synthetic used exported generic class beside unrelated Error prose
// verdict: pass
// oxfmt-ignore
export class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}
export const sampleValue = new Sequence().value;
