// rule: async-defer-await
// weakness: control-flow
// source: react-bench Bindery trial and PR #1272

declare const load: () => Promise<string[]>;
declare const latestRequest: { current: number };
declare const latestReview: { current: number };

export const run = async () => {
  const requestId = latestRequest.current;
  const reviewVersion = latestReview.current;
  const rows = await load();
  if (requestId !== latestRequest.current || reviewVersion !== latestReview.current) return [];
  return rows;
};
