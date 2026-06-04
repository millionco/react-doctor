"use client";

import { useEffect, useState } from "react";

interface IssueDemoProps {
  items: string[];
  html: string;
}

export const IssueDemo = ({ items, html }: IssueDemoProps) => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(count + 1);
  }, []);

  return (
    <div>
      <img src="/logo.png" />

      <a href="https://example.com" target="_blank">
        External link
      </a>

      <div dangerouslySetInnerHTML={{ __html: html }} />

      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>

      <button onClick={() => setCount(count + 1)}>Count: {count}</button>
    </div>
  );
};
