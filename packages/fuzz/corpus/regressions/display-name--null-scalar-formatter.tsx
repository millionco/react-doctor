// rule: display-name
// weakness: control-flow
// source: saved candidate audit, nullable scalar formatter
// verdict: pass
export const createFormatter = (allowHtml: boolean) => (value: unknown) => {
  if (allowHtml && value === null) return <span>Missing</span>;
  return String(value);
};
