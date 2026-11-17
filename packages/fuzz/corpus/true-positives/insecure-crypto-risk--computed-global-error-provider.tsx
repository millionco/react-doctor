// rule: insecure-crypto-risk
// weakness: dynamic-computed
// source: Synthetic unknown computed global write can replace the Error provider
// verdict: fail
const provider = "Error";
globalThis[provider] = class {};
// oxfmt-ignore
class Data{constructor(){this.key=Math.random()}fail(){throw new Error("Invalid token in expression")}}
