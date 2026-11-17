// rule: insecure-crypto-risk
// weakness: control-flow
// source: Synthetic random producer with a security consumer after unrelated Error prose
// verdict: fail
// oxfmt-ignore
class Sequence{value=0;constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}
export const issue = () => ({ sessionToken: new Sequence().value });
