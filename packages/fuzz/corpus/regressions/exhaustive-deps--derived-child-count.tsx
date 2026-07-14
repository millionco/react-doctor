// rule: exhaustive-deps
// weakness: effect-semantics
// source: react-bench coreui/coreui-react oracle validation
import { Children, useEffect, useState } from "react";

export const CarouselItemCount = ({ children }) => {
  const [itemCount, setItemCount] = useState(0);
  useEffect(() => {
    setItemCount(Children.toArray(children).length);
  });
  return <output>{itemCount}</output>;
};
