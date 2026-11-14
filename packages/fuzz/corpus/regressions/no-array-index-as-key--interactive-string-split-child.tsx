// rule: no-array-index-as-key
// verdict: fail
// weakness: primitive-child
// source: independent synthetic boundary control
export const SelectableTokens = ({ text }: { text: string }) => (
  <span>
    {text.split(" ").map((token, index) => (
      <span key={index} onClick={() => undefined}>
        {token.split(":")[1]}
      </span>
    ))}
  </span>
);
