// rule: click-events-have-key-events
// weakness: transparent-spread
// source: ISSUES_TO_FIX_ASAP.md semantic mutation matrix
export const PreviewCard = ({ open }: { open: () => void }) => (
  <div {...{ onClick: open }}>Preview</div>
);
