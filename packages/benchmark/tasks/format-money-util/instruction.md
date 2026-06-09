Implement the `formatMoney` utility in `src/format-money.ts`.

## Expected behavior

`formatMoney(amountCents, options?)` converts an integer amount in **minor
units** (cents) into a display string.

- The amount is always an integer number of cents. Divide by 100 for the major
  unit. Example: `1234` → `"$12.34"`.
- `options.currency` is an ISO 4217 code (default `"USD"`). Render the correct
  symbol for at least: `USD` → `$`, `EUR` → `€`, `GBP` → `£`, `JPY` → `¥`.
  For any other code, prefix the amount with the uppercased code and a space,
  e.g. `formatMoney(500, { currency: "chf" })` → `"CHF 5.00"`.
- `JPY` has **no minor unit**: render no decimals and treat `amountCents` as
  whole yen — `formatMoney(1200, { currency: "JPY" })` → `"¥1,200"`.
- Negative amounts render with a leading minus before the symbol:
  `formatMoney(-1234)` → `"-$12.34"`.
- Always show exactly two decimals for minor-unit currencies, **unless**
  `options.trimZeroCents` is `true` and the amount is a whole major unit, in
  which case drop the decimals: `formatMoney(1000, { trimZeroCents: true })`
  → `"$10"`, but `formatMoney(1050, { trimZeroCents: true })` → `"$10.50"`.
- Group the integer part with commas: `formatMoney(123456789)` →
  `"$1,234,567.89"` (grouping applies to every currency, including `JPY`).

## Constraints

Keep the exported `formatMoney` signature and the `FormatMoneyOptions`
interface. Do not change `src/price-tag.tsx`.
