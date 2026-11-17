// rule: iframe-missing-sandbox
// weakness: name-heuristic
// source: Synthetic DOM receiver policy regression
// verdict: pass
export const createDetachedFrame = (ownerDocument: Document) => {
  const documentAlias = ownerDocument;
  return documentAlias.createElement("iframe");
};
