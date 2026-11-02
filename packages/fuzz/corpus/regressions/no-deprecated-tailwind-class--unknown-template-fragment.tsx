// rule: no-deprecated-tailwind-class
// weakness: wrapper-transparency
// source: synthetic unknown template fragment
// verdict: pass

interface FragmentPanelProps {
  suffix: string;
}

export const FragmentPanel = ({ suffix }: FragmentPanelProps) => (
  <span className={`flex-shrink-${suffix}`} />
);
