import { groupBy } from "./group-by.ts";

export interface InventoryItem {
  sku: string;
  category: string;
  quantity: number;
}

// Existing consumer (keeps group-by.ts reachable). Do not edit.
export const groupByCategory = (items: InventoryItem[]) => groupBy(items, "category");
