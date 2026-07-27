import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeCliHelp } from "./normalize-cli-help.ts";
import { parseHelpCommandAliases } from "./parse-help-command-aliases.ts";

describe("CLI help contracts", () => {
  it("normalizes only ANSI, line endings, the working directory, and version", () => {
    const output =
      '\u001B[2mUsage:\u001B[22m tool 1.2.3\r\n  --cwd <cwd>  working directory (default: "C:\\repo\\project")\r\n' +
      "                 with wrapped text\r\n";

    assert.equal(
      normalizeCliHelp(output, "C:\\repo\\project", "1.2.3"),
      'Usage: tool <version>\n  --cwd <cwd>  working directory (default: "<cwd>")\n' +
        "                 with wrapped text\n",
    );
  });

  it("normalizes Windows wrapping around the dynamic working directory", () => {
    const output =
      '  -c, --cwd <cwd>  working directory (default:\r\n                     "C:\\Users\\runner\\AppData\\Local\\Temp")\r\n';

    assert.equal(
      normalizeCliHelp(output, "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp"),
      '  -c, --cwd <cwd>  working directory (default: "<cwd>")\n',
    );
  });

  it("extracts canonical commands and aliases without wrapped descriptions", () => {
    const output = `Usage: tool [command]

Commands:
  install|setup [options]  Install the integration
                           with a wrapped description
  rules                    Configure rules

Examples:
  tool rules
`;

    assert.deepEqual(parseHelpCommandAliases(output), ["install", "setup", "rules"]);
  });
});
