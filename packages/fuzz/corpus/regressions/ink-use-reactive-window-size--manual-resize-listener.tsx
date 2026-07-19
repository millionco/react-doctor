// rule: ink-use-reactive-window-size
// weakness: library-idiom
// source: aflekkas/rawdog manual SIGWINCH-compatible resize handling
import { Text } from "ink";
import { useEffect, useState } from "react";

export const App = () => {
  const [columns, setColumns] = useState(process.stdout.columns);
  useEffect(() => {
    const update = () => setColumns(process.stdout.columns);
    process.stdout.on("resize", update);
    return () => process.stdout.off("resize", update);
  }, []);
  return <Text>{columns}</Text>;
};
