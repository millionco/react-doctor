import { Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { spawn } from "node:child_process";
import {
  Box,
  Newline,
  Static,
  Text,
  measureElement,
  render,
  renderToString,
  useCursor,
  useFocusManager,
  useInput,
  useStdin,
} from "ink";

export const InkFuzzTarget = ({ items, label, node }) => {
  const focusManager = useFocusManager();
  const cursor = useCursor();
  const { setRawMode } = useStdin();
  const [frame, setFrame] = useState(0);
  measureElement(node);
  focusManager.focus("target");
  setRawMode(true);
  cursor.setCursorPosition({ x: label.length, y: 0 });
  useInput((input, key) => {
    if (key.ctrl && input === "c") process.exit(0);
    if (input.includes("\n")) paste(input);
    spawn("vim", [], { stdio: "inherit" });
  });
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box>
      raw
      <div />
      <Link to="/" />
      <Newline />
      <Text aria-role="dialog">
        <Box />
      </Text>
      <Static items={items.toReversed()}>{(item) => <Text>{item}</Text>}</Static>
      <Static items={items} />
      <Text>{process.stdout.columns + frame}</Text>
    </Box>
  );
};

render(
  <Suspense fallback={null}>
    <Text />
    <InkFuzzTarget items={[]} label="界" node={null} />
  </Suspense>,
);
render(<Text />);
renderToString(<InkFuzzTarget items={[]} label="界" node={null} />);
