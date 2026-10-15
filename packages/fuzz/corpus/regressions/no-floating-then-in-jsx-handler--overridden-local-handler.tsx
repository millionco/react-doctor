// rule: no-floating-then-in-jsx-handler
// weakness: alias-guard
// source: synthetic authoritative attribute regression
// verdict: pass
export const CopyControl = ({ value }: { value: string }) => {
  const handleCopy = () => navigator.clipboard?.writeText(value).then(() => console.log("Copied"));
  return (
    <button onClick={handleCopy} {...{ onClick: undefined }}>
      Copy
    </button>
  );
};
