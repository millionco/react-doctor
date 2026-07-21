// rule: no-side-tab-border
// weakness: library-idiom
// source: 0.8.1-to-main all-rules parity (Cawlumm/lyftr, zeon-studio/commerceplate, cyntler/hamburger-react)
// verdict: pass
export const ScannerCorner = () => (
  <div className="rounded-tl border-t-2 border-l-2 border-brand-400" />
);

export const OutlinedTab = () => (
  <div className="rounded-t-md border-t-2 border-l-2 border-r-2 border-b-0 border-brand" />
);
