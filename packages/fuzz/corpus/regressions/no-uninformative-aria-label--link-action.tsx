// rule: no-uninformative-aria-label
// weakness: name-heuristic
// source: RDE OSS corpus, calcom/cal.com packages/ui

interface ToolbarButtonProps {
  readonly "aria-label": string;
  readonly children: React.ReactNode;
}

const ToolbarButton = (props: ToolbarButtonProps) => <button {...props} />;

export const LinkControl = () => (
  <ToolbarButton aria-label="Link">
    <span aria-hidden="true">🔗</span>
  </ToolbarButton>
);
