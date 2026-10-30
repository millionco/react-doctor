// rule: insecure-crypto-risk
// weakness: name-heuristic
// source: Synthetic erased-only Function binding with visible Error provider replacement
// verdict: fail
interface Function {
  note: string;
}
Function("globalThis.Error = function(message){ globalThis.saved=message; }")();
// oxfmt-ignore
class Data { constructor(){this.key=Math.random()} fail(){throw new Error("Invalid token in expression")} }
