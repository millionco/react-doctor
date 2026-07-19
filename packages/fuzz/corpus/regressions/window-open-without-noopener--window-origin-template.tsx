// rule: window-open-without-noopener
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (AppFlowy as-template: `${window.origin}/…` template is same-origin by construction)
export const AsTemplateButton = ({ publishUrl }: { publishUrl: string }) => {
  const handleClick = () => {
    window.open(`${window.origin}/as-template?viewUrl=${encodeURIComponent(publishUrl)}`, "_blank");
  };
  return (
    <button type="button" onClick={handleClick}>
      Use as template
    </button>
  );
};
