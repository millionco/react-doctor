import type { SymbolKind } from "@rayhanadev/truffler";
import { CliInputError } from "./cli-input-error.js";

export interface ParsedFindKinds {
  readonly requestedKinds: ReadonlySet<string>;
  readonly symbolKinds: ReadonlyArray<SymbolKind>;
}

const DEFAULT_SYMBOL_KINDS: ReadonlyArray<SymbolKind> = [
  "class",
  "enum",
  "function",
  "interface",
  "method",
  "property",
  "type",
];

const ALL_SYMBOL_KINDS: ReadonlyArray<SymbolKind> = [
  "class",
  "constant",
  "enum",
  "enum-member",
  "export",
  "function",
  "import",
  "interface",
  "method",
  "property",
  "type",
  "variable",
];

const SYMBOL_KIND_SET: ReadonlySet<string> = new Set(ALL_SYMBOL_KINDS);
const REACT_SYMBOL_KINDS: ReadonlySet<string> = new Set(["component", "hook"]);

export const FIND_KIND_HELP = [...ALL_SYMBOL_KINDS, ...REACT_SYMBOL_KINDS].join(",");

const isSymbolKind = (value: string): value is SymbolKind => SYMBOL_KIND_SET.has(value);

export const parseFindKinds = (value: string | undefined): ParsedFindKinds => {
  if (value === undefined) {
    return {
      requestedKinds: new Set([...DEFAULT_SYMBOL_KINDS, "component", "hook"]),
      symbolKinds: [...DEFAULT_SYMBOL_KINDS, "constant", "variable"],
    };
  }

  const requestedKinds = new Set(value.split(",").map((kind) => kind.trim()));
  const unsupportedKind = [...requestedKinds].find(
    (kind) => !isSymbolKind(kind) && !REACT_SYMBOL_KINDS.has(kind),
  );
  if (unsupportedKind !== undefined) {
    throw new CliInputError(
      `Unsupported symbol kind "${unsupportedKind}". Expected one of: ${FIND_KIND_HELP}.`,
    );
  }

  const symbolKinds = new Set<SymbolKind>();
  for (const kind of requestedKinds) {
    if (isSymbolKind(kind)) symbolKinds.add(kind);
    if (kind === "component") {
      symbolKinds.add("class");
      symbolKinds.add("constant");
      symbolKinds.add("function");
      symbolKinds.add("variable");
    }
    if (kind === "hook") {
      symbolKinds.add("constant");
      symbolKinds.add("function");
      symbolKinds.add("variable");
    }
  }

  return { requestedKinds, symbolKinds: [...symbolKinds] };
};
