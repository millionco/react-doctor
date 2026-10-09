// rule: no-array-index-as-key
// verdict: pass
export const Breadcrumb = () => {
  const route = "/guide/start";
  const parts = route.split("/").filter(Boolean);
  return parts.map((part, index) => (
    <span key={index}>
      <span>{part}</span>
    </span>
  ));
};
