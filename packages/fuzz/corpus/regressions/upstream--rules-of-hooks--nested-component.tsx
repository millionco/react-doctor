// rule: react-hooks/rules-of-hooks (react-compiler)
// weakness: name-heuristic
// source: facebook/react#29165 (hooks inside a component nested in another component)
import { useMemo, useState } from "react";

export const Outer = ({ items }: { items: string[] }) => {
  const InnerList = () => {
    const [query, setQuery] = useState("");
    const visibleItems = useMemo(() => items.filter((item) => item.includes(query)), [query]);
    return (
      <div>
        <input value={query} onChange={(event) => setQuery(event.target.value)} />
        {visibleItems.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    );
  };

  return <InnerList />;
};
