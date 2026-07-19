// rule: no-controlled-input-value-without-state-update
// weakness: semantic-intent
// source: React Bench audit of millionco/react-doctor#1000

interface ToolbarProps {
  value: string;
}

export const Toolbar = ({ value }: ToolbarProps) => (
  <input aria-label="Current value" onChange={() => {}} value={value} />
);
