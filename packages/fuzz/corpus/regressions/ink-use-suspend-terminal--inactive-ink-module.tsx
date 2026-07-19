// rule: ink-use-suspend-terminal
// weakness: component-ownership
// source: adversarial audit of PR 1404 terminal lifecycle ownership
import { spawn } from "node:child_process";
import { Text } from "ink";

export const launchEditor = () => spawn("vim", [], { stdio: "inherit" });
export const App = () => <Text>Ready</Text>;
