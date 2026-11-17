// rule: insecure-crypto-risk
// weakness: wrapper-transparency
// source: Synthetic generic exported concise arrow beside unrelated Error prose
// verdict: pass
// oxfmt-ignore
export const next=()=>Math.random(),parse=()=>{throw new Error("Invalid token")};
