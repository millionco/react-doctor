import { z } from "zod";

const gatewayCostSchema = z.object({
  gateway: z.object({ cost: z.union([z.string(), z.number()]) }),
});

export const getClassificationCost = (provenance: unknown): number | null => {
  if (!provenance || typeof provenance !== "object") return null;
  const costs: number[] = [];
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    const parsed = gatewayCostSchema.safeParse(value);
    if (parsed.success) {
      const cost = Number(parsed.data.gateway.cost);
      if (Number.isFinite(cost) && cost >= 0) costs.push(cost);
    }
    for (const child of Object.values(value)) visit(child);
  };
  visit(provenance);
  return costs.length > 0 ? costs.reduce((total, cost) => total + cost, 0) : null;
};
