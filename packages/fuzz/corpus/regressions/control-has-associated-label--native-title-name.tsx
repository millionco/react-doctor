// rule: control-has-associated-label
// weakness: name-heuristic
// source: React Bench Lumina Note trials documented in PR #1230

interface IconButtonProps {
  label: string;
  onActivate: () => void;
}

export const TitleNamedIconButton = ({ label, onActivate }: IconButtonProps) => (
  <button type="button" title={label} onClick={onActivate}>
    <svg aria-hidden="true" />
  </button>
);
