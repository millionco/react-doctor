// rule: no-non-null-assertion-on-maybe-undefined-result
// weakness: regex-semantics
// source: independent synthetic regression
// verdict: pass

export const MatchWidth = ({ text }: { text: string }) => (
  <span>{text.match(/:*$/)![0].length}</span>
);
