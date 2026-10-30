// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: regex-semantics
// source: independent synthetic regression

export const SuffixWidth = ({ text }: { text: string }) => (
  <span>{text.match(/:*$/)![0].length}</span>
);

export const PrefixWidth = ({ text }: { text: string }) => (
  <span>{/^ */.exec(text)![0].length}</span>
);
