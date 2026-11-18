// rule: no-array-index-as-key
// weakness: local-interface-inheritance
// source: synthetic audit regression
interface TokenData {
  text: string;
}
interface MiddleProps extends TokenData {
  label?: string;
}
interface ViewProps extends MiddleProps {}
export const TokenLine = ({ text }: ViewProps) => {
  const separator = /([,;])/g;
  const content = text?.split(separator).map((part, index) => {
    if (index % 2 === 1) return <span key={index}>{part}</span>;
    return part;
  });
  return <p>{content}</p>;
};
