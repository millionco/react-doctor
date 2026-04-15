import { useState, useEffect, useMemo } from "react";

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

const HeavyMemoizedIteration = ({
  users,
  currentUserId,
}: {
  users: { id: number; isSelected: boolean }[];
  currentUserId: number;
}) => {
  const selectedUserCount = useMemo(
    () =>
      users.filter((user) => user.id !== currentUserId).filter((user) => user.isSelected).length,
    [currentUserId, users],
  );

  return <div>{selectedUserCount}</div>;
};

export { Counter, MemberExpressionSetterCalls, HeavyMemoizedIteration };
