// rule: insecure-crypto-risk
// weakness: alias-guard
// source: Synthetic inherited setter prevents a constructor assignment from creating random output
// verdict: pass
Object.defineProperty(Object.prototype, "value", {
  get() {
    return "fixed";
  },
  set(input) {},
});
// oxfmt-ignore
class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}
const sessionToken = new Sequence().value;
