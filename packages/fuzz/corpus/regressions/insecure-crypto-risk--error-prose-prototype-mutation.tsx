// rule: insecure-crypto-risk
// weakness: copy-tracking
// source: Synthetic prototype and alias mutations replacing constructed random output
// verdict: pass
// oxfmt-ignore
class Sequence{constructor(){this.value=Math.random()}parse(){throw new Error("Invalid token")}}
const Alias = Sequence;
Object.defineProperty(Alias.prototype, "value", {
  get() {
    return "fixed";
  },
  set(input) {},
});
const firstToken = new Alias().value;
// oxfmt-ignore
class Prototype{constructor(){this.__proto__=Math.random()}parse(){throw new Error("Invalid token")}}
const secondToken = new Prototype().__proto__;
