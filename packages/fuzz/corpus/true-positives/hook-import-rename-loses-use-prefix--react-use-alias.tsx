// rule: hook-import-rename-loses-use-prefix
// weakness: provenance
// source: PR #1000 deep audit

import { use as readPromise } from "react";

interface Product {
  id: string;
}

interface ProductsProps {
  productsPromise: Promise<Product[]>;
}

export const Products = ({ productsPromise }: ProductsProps) => {
  const products = readPromise(productsPromise);
  return <div>{products.length}</div>;
};
