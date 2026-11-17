// rule: insecure-crypto-risk
// weakness: control-flow
// source: Synthetic random producer with a visible security binding after unrelated Error prose
// verdict: fail
// oxfmt-ignore
export const next=()=>{return Math.random()},parse=()=>{throw new Error("Invalid token")};
const sessionToken = next();
