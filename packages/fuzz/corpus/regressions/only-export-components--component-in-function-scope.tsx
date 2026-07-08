// rule: only-export-components
// weakness: control-flow
// source: fuzz FP hunt 2026-07 (components declared inside test callbacks /
// factories are not Fast Refresh boundaries; the local-component walk must
// stay at module scope like eslint-plugin-react-refresh's)
declare const test: (name: string, run: () => void) => void;
declare const render: (element: unknown) => void;

test("renders the harness", () => {
  const Harness = () => <div>harness</div>;
  render(<Harness />);
});

function setup() {
  const Row = () => <span>row</span>;
  return Row;
}

export const config = setup();
