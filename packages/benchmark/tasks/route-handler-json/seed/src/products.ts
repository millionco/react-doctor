export interface Product {
  id: string;
  name: string;
  priceCents: number;
}

// Static catalog the route handler serves. Do not edit.
export const PRODUCTS: Product[] = [
  { id: "p1", name: "Notebook", priceCents: 1200 },
  { id: "p2", name: "Pen", priceCents: 250 },
  { id: "p3", name: "Eraser", priceCents: 99 },
];
