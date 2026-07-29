import { memo } from "react";

interface PriceProperties {
  amount: number;
}

const PriceView = ({ amount }: PriceProperties) => <output>{amount}</output>;

export const Price = memo(PriceView, () => false);
