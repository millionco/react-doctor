// rule: only-export-components
// weakness: default-function-overload
// source: synthetic audit regression
export default function Panel(props: { label: string }): React.JSX.Element;
export default function Panel(props: { label: number }): React.JSX.Element;
export default function Panel({ label }: { label: string | number }) {
  return <section>{label}</section>;
}
