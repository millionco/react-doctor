// rule: jsx-handler-names
// weakness: alias-guard
// source: synthetic component declaration internal binding regression
// verdict: fail
interface ActionProps {
  onClick: () => void;
}

declare const receiveComponent: (component: unknown) => void;

export function Action(input: ActionProps) {
  receiveComponent(Action);
  return <button onClick={input.onClick}>Continue</button>;
}
