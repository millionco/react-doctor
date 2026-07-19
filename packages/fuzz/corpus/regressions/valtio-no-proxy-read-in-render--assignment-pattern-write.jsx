import { useSnapshot } from "valtio";

export const Counter = ({ source, state }) => {
  const snapshot = useSnapshot(state);
  ({ count: state.count } = source);
  return <span>{snapshot.count}</span>;
};
