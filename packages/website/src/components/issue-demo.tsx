"use client";

import { useState } from "react";

interface IssueDemoProps {
  items: string[];
}

// Intentional React anti-patterns so the React Doctor GitHub Action has
// something to report on this pull request. Safe to delete — this component is
// not rendered anywhere on the site.
export const IssueDemo = ({ items }: IssueDemoProps) => {
  const [count, setCount] = useState(0);

  return (
    <div style={{ padding: 8 }}>
      <button onClick={() => setCount(count + 1)}>Clicked {count} times</button>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
};
