// rule: jsx-no-constructed-context-values
// weakness: mutation
// source: deep audit of PR #1000
import { createContext } from "react";

var ThemeContext = createContext(null);
var ThemeContext = FakeContext;

export const App = () => <ThemeContext value={{ theme: "dark" }} />;
