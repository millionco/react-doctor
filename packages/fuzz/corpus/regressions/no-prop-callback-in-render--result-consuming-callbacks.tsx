// rule: no-prop-callback-in-render
// weakness: library-idiom
// source: PR #1130 Bugbot review
import { useMemo } from "react";

interface TransformListProps {
  items: string[];
  transformItem: (item: string) => string;
}

export const TransformList = ({ items, transformItem }: TransformListProps) => {
  items.map<string>((item) => transformItem(item));
  Array.from(items, (item) => transformItem(item));
  useMemo(() => transformItem(items[0] ?? ""), [items, transformItem]);
  return null;
};
