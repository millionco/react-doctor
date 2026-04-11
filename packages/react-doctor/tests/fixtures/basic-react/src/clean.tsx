import { useState, useEffect } from "react";

const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount((previous) => previous + 1)}>{count}</button>;
};

const MemberExpressionSetterCalls = () => {
  const [count, setCount] = useState(0);

  useEffect(() => {
    localStorage.setItem("count", String(count));
  }, [count]);

  return (
    <button
      onClick={() => {
        localStorage.setItem("clicked", "true");
        sessionStorage.setItem("clicked", "true");
        setCount((previous) => previous + 1);
      }}
    >
      {count}
    </button>
  );
};

export { Counter, MemberExpressionSetterCalls };
