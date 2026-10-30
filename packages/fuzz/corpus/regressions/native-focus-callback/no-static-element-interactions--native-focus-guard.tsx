// rule: click-events-have-key-events, no-static-element-interactions
// weakness: control-flow
// source: invented synthetic regression
// verdict: pass

export const ReedField = () => {
  const handlePointer = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!(event.target as Element).closest(".reed-token")) {
      document.querySelector<HTMLInputElement>("#reed-search")?.focus();
    }
  };
  return <div onClick={handlePointer} />;
};
