// rule: insecure-crypto-risk
// weakness: control-flow
// source: Synthetic constructed fields replaced by constructor writes, returns, and accessors
// verdict: pass
// oxfmt-ignore
class Overwritten{constructor(){this.value=Math.random();this.value="fixed"}parse(){throw new Error("Invalid token")}}
const firstToken = new Overwritten().value;
// oxfmt-ignore
class Returned{constructor(){this.value=Math.random();return {value:"fixed"}}parse(){throw new Error("Invalid token")}}
const secondToken = new Returned().value;
// oxfmt-ignore
class Accessor{constructor(){this.value=Math.random()}get value(){return "fixed"}set value(input){}parse(){throw new Error("Invalid token")}}
const thirdToken = new Accessor().value;
