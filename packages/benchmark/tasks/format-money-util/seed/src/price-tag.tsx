import { formatMoney } from "./format-money.ts";

interface PriceTagProps {
  amountCents: number;
  currency?: string;
}

// Existing component that consumes the util (keeps format-money.ts reachable).
// Not part of the task — do not edit.
export const PriceTag = ({ amountCents, currency }: PriceTagProps) => (
  <span className="price-tag">{formatMoney(amountCents, { currency })}</span>
);
