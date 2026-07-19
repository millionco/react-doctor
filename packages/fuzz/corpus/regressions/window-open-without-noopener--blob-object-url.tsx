// rule: window-open-without-noopener
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (attachment preview: blob: URL of the user's own uploaded content, no opener hazard)
export const ExportPreviewButton = ({ svgRef }: { svgRef: { current: SVGSVGElement | null } }) => {
  const handleExport = () => {
    if (!svgRef.current) return;
    const svgMarkup = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgMarkup], { type: "image/svg+xml" });
    const objectUrl = URL.createObjectURL(blob);
    window.open(objectUrl, "_blank");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  };
  return (
    <button type="button" onClick={handleExport}>
      Preview export
    </button>
  );
};
