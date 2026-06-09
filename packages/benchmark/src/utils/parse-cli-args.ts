// Minimal `--flag value` / `--flag` parser. Avoids a CLI-framework dependency
// so the verifier bundles tiny and starts fast in the sandbox. Unknown flags
// are ignored; `--flag=value` and `--flag value` are both accepted.
export const parseCliArgs = (argv: string[]): Record<string, string | boolean> => {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) continue;
    const body = token.slice(2);
    const equalsIndex = body.indexOf("=");
    if (equalsIndex !== -1) {
      parsed[body.slice(0, equalsIndex)] = body.slice(equalsIndex + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      parsed[body] = next;
      index++;
    } else {
      parsed[body] = true;
    }
  }
  return parsed;
};
