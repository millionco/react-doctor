// rule: no-array-index-deref-without-bounds-or-empty-guard
// weakness: alias-guard
// source: independently synthetic readonly split alias
// verdict: pass
export const SplitLabel = ({ text }: { text: string }) => {
  const pieces = text.split("~");
  if (!pieces[1]) return null;
  return <span>{pieces[1].trim()}</span>;
};
