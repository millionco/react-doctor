// rule: no-array-index-as-key
// weakness: control-flow
// source: independently-authored-public-synthetic
// verdict: pass
interface TokenListProps {
  values: unknown[];
  pattern: RegExp;
}

export const TokenList = (props: TokenListProps) =>
  props.values.map((value, index) =>
    typeof value === "string" && value.match(props.pattern) ? (
      <mark key={index}>{value}</mark>
    ) : null,
  );
