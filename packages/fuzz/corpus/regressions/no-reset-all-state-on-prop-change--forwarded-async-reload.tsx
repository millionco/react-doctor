// rule: no-reset-all-state-on-prop-change
// weakness: forwarded-setter
// source: search results cleared before a forwarded asynchronous reload
// verdict: pass
import { useEffect, useState } from "react";

const assign = <T,>(setter: (next: T) => void, next: T) => setter(next);

interface ResultsProps {
  query: string;
  search: (query: string) => Promise<string[]>;
}

export const Results = ({ query, search }: ResultsProps) => {
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    setItems([]);
    search(query).then((next) => assign(setItems, next));
  }, [query, search]);

  return items.map((item) => <p key={item}>{item}</p>);
};
