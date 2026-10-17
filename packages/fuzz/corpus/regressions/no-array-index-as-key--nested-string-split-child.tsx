// rule: no-array-index-as-key
// verdict: pass
// weakness: primitive-child
// source: independent synthetic regression
export const DisplayTokens = ({ text }: { text: string }) => (
  <span>
    {text.split(" ").map((token, index) => (
      <span key={index}>
        <b>{token.split(":")[1]}</b>
      </span>
    ))}
  </span>
);
