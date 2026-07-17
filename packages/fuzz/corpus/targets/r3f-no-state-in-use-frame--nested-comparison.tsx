// rule: r3f-no-state-in-use-frame
// source: Cursor Bugbot review on millionco/react-doctor#1371
import { useFrame } from "@react-three/fiber";
import { useState } from "react";

export const NestedComparisonState = ({ items, selectedId }) => {
  const [count, setCount] = useState(0);
  useFrame(() => {
    if (items.some((item) => item.id !== selectedId)) setCount(count + 1);
  });
  return count;
};
