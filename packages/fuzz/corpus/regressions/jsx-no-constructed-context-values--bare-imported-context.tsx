// rule: jsx-no-constructed-context-values
// weakness: provenance
// source: deep audit of PR #1000
import { ThemeContext } from "./theme-context";

export const App = () => <ThemeContext value={{ theme: "dark" }} />;
