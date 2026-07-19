// rule: ink-static-is-append-only
// weakness: library-idiom
// source: adversarial audit of PR 1404 against Ink Static semantics
import { Static } from "ink";

export const App = () => <Static items={[1, 2, 3].filter(Boolean)}>{() => null}</Static>;

export const SortedApp = () => <Static items={[3, 1, 2].toSorted()}>{() => null}</Static>;
