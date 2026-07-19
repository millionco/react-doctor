// rule: server-dedup-props
// weakness: framework-gating
// source: kriziu/shoes-ecommerce ReceivedMail.tsx, React Doctor Daytona eval 2026-07-19

interface ProductListProperties {
  productKeys: string[];
}

interface ProductProperties {
  size: string;
}

const Product = ({ size }: ProductProperties) => <span>{size}</span>;

export const ProductList = ({ productKeys }: ProductListProperties) =>
  productKeys.map((productKey) => <Product key={productKey} size={productKey.slice(-2)} />);
