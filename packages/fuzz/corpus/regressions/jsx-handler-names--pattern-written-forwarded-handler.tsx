// rule: jsx-handler-names
// weakness: copy-tracking
// source: synthetic assigned forwarded handler regression
// verdict: fail
interface ActionProps {
  onClick: () => void;
}

const replacement: ActionProps = { onClick: () => {} };

export const Action = (input: ActionProps) => {
  ({ onClick: input.onClick } = replacement);
  return <button onClick={input.onClick}>Continue</button>;
};
