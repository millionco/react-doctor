// rule: no-array-index-as-key
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail
interface TokenListProps {
  values: unknown[];
  replacement: unknown;
}

export const TokenList = (props: TokenListProps) =>
  props.values.map(
    (value, index) =>
      typeof value === "string" && (([value] = [props.replacement]), (<b key={index}>{value}</b>)),
  );
