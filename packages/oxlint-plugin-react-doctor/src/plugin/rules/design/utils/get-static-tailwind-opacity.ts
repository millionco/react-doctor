export const getStaticTailwindOpacity = (utility: string): number | null => {
  const scaleMatch = /^opacity-(\d+(?:\.\d*)?|\.\d+)$/.exec(utility);
  if (scaleMatch?.[1]) return Number.parseFloat(scaleMatch[1]);
  const arbitraryMatch = /^opacity-\[(\d+(?:\.\d*)?|\.\d+)%?\]$/.exec(utility);
  return arbitraryMatch?.[1] ? Number.parseFloat(arbitraryMatch[1]) : null;
};
