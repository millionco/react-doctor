import { useEffect } from "react";

function readSnapshot(previous, current) {
  return previous.id === current.id && arguments[1].extra;
}

export const Example = ({ id, extra, onValue }) => {
  const snapshot = { id, extra };
  const previous = { id: "fixed" };
  useEffect(() => {
    onValue(readSnapshot(previous, snapshot));
  }, [snapshot.id, previous.id, onValue]);
  return null;
};
