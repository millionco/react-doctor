// rule: no-array-index-as-key
// weakness: alias-guard
// source: independently-authored-public-synthetic
// verdict: fail
interface TokenListProps {
  values: unknown[];
}

export const TokenList = (props: TokenListProps) =>
  props.values.map((value, index) => {
    index = 0;
    return typeof value === "string" ? <b key={index}>{value}</b> : null;
  });
