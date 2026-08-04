import { memo } from "react";

interface ItemProperties {
  label: string;
  revision: number;
}

declare const compareItems: (
  previousProperties: ItemProperties,
  nextProperties: ItemProperties,
) => boolean;

const ItemView = ({ label, revision }: ItemProperties) => (
  <output>
    {label}: {revision}
  </output>
);

export const Item = memo(ItemView, compareItems);
