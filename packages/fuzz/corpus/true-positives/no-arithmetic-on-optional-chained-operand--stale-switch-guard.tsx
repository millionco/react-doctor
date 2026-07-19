// rule: no-arithmetic-on-optional-chained-operand
// weakness: control-flow
// source: Cursor Bugbot review on PR #1387
export const total = (order?: { status: string; amount: number }): number => {
  switch (order?.status) {
    case "paid":
      order = undefined;
      return order?.amount * 2;
    default:
      return 0;
  }
};
