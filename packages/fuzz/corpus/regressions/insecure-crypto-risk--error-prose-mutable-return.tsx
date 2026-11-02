// rule: insecure-crypto-risk
// weakness: control-flow
// source: Synthetic mutable producers and impossible returns beside unrelated Error prose
// verdict: pass
// oxfmt-ignore
let sample=()=>Math.random(),parse=()=>{throw new Error("Invalid token")};
sample = () => "fixed";
const alias = sample;
const firstToken = alias();
// oxfmt-ignore
const interrupted=()=>{try{return Math.random()}finally{throw new Error("stopped")}},parseInterrupted=()=>{throw new Error("Invalid token")};
const secondToken = interrupted();
// oxfmt-ignore
const unreachable=()=>{const value=Math.random();throw "stop";return value},parseUnreachable=()=>{throw new Error("Invalid token")};
const thirdToken = unreachable();
