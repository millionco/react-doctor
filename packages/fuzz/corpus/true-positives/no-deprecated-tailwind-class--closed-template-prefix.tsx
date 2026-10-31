// rule: no-deprecated-tailwind-class
// weakness: wrapper-transparency
// source: synthetic closed template prefix
// verdict: fail

interface PrefixPanelProps {
  active: boolean;
}

export const PrefixPanel = ({ active }: PrefixPanelProps) => (
  <span className={`inline-flex flex-shrink-0 ${active ? "rotate-180" : ""}`} />
);
