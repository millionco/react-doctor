import { useReducer } from "react";

interface CounterState {
  count: number;
}

interface CounterAction {
  type: "decrement" | "increment";
}

const initializeCounter = (initialCount: number): CounterState => ({
  count: initialCount,
});

const reduceCounter = (state: CounterState, action: CounterAction): CounterState => {
  switch (action.type) {
    case "decrement":
      return { count: state.count - 1 };
    case "increment":
      return { count: state.count + 1 };
  }
};

export const Counter = () => {
  const [state, dispatch] = useReducer(reduceCounter, 1, initializeCounter);
  return (
    <button type="button" onClick={() => dispatch({ type: "increment" })}>
      {state.count}
    </button>
  );
};
