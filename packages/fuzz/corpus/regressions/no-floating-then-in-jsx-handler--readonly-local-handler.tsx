// rule: no-floating-then-in-jsx-handler
// weakness: alias-guard
// source: synthetic readonly local handler regression
// verdict: fail
export const CopyControl = ({ value }: { value: string }) => {
  const handleCopy = () => {
    navigator.clipboard?.writeText(value).then(() => console.log("Copied"));
  };
  return <button onClick={handleCopy}>Copy</button>;
};
