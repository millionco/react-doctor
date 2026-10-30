// rule: no-decorative-pulse
// weakness: library-idiom
// verdict: pass
export const ExportProgress = () => (
  <section>
    <progress aria-label="Snapshot export" className="animate-pulse">
      Snapshot export
    </progress>
    <progress value={null} aria-label="Archive transfer" className="animate-pulse">
      Archive transfer
    </progress>
  </section>
);
