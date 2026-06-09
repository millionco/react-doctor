import { PRODUCTS } from "../../../src/products.ts";

export const GET = async (request: Request): Promise<Response> => {
  const maxPriceCentsParam = new URL(request.url).searchParams.get("maxPriceCents");
  const maxPriceCents =
    maxPriceCentsParam === null ? Number.POSITIVE_INFINITY : Number(maxPriceCentsParam);
  const matching = PRODUCTS.filter((product) => product.priceCents <= maxPriceCents);
  return Response.json(matching);
};
