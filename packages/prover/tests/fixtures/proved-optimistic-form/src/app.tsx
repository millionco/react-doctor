import { useOptimistic, useState } from "react";

export const TodoForm = () => {
  const [confirmedTodos, setConfirmedTodos] = useState<ReadonlyArray<string>>(["Read"]);
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    confirmedTodos,
    (pendingTodos, todo: string) => [...pendingTodos, todo],
  );
  const submitAction = (_formData: FormData) => {
    addOptimisticTodo("Write");
    setConfirmedTodos((previousTodos) => [...previousTodos, "Write"]);
  };

  return (
    <form action={submitAction}>
      <button type="submit">Add todo</button>
      <output>{optimisticTodos.join(", ")}</output>
    </form>
  );
};
