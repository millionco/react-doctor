// rule: async-defer-await
// verdict: pass
// weakness: control-flow
// source: issue #1895

declare function fetchResult(query: string): Promise<string>;
declare function setValue(value: string): void;

const requestId = { current: 0 };
const latest = { current: { query: "" } };

export const lookup = async (query: string, id: number) => {
  const result = await fetchResult(query);
  if (id !== requestId.current || latest.current.query !== query) return;
  setValue(result);
};
