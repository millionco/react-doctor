export interface FormatMoneyOptions {
  // ISO 4217 currency code, e.g. "USD", "EUR", "JPY". Defaults to "USD".
  currency?: string;
  // When true, drop the fractional part for whole amounts ($10 instead of $10.00).
  trimZeroCents?: boolean;
}

// TODO(agent): implement. See instruction.md for the exact contract.
export const formatMoney = (_amountCents: number, _options?: FormatMoneyOptions): string => {
  throw new Error("not implemented");
};
