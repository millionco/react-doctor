// rule: jsx-key
// weakness: attribute-order
// source: brain cognition 2026-06-24
interface RowProps {
  label: string;
}

declare const props: RowProps;

export const Row = () => <div {...props} key="stable" />;
