// rule: no-array-index-as-key
// weakness: inherited-string-type
// source: synthetic
// verdict: pass
interface FuzzTokenData {
  value: string;
}
interface FuzzTokenProps extends FuzzTokenData {}
export const FuzzTokenView = ({ value }: FuzzTokenProps) => (
  <p>
    {value.split(/([,;])/g).map((token, position) => (
      <span key={position}>{token}</span>
    ))}
  </p>
);
