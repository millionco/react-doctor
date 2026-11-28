import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { collectCrossFileDependencyProbes } from "../../cross-file-dependencies.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noDerivedState } from "./no-derived-state.js";

const field = `export const MessageInput = ({ message, writeMessage }) => (
  <input type="email" value={message} onChange={(event) => writeMessage(event.target.value)} />
);`;

const app = `import { useEffect, useState } from "react";
import { MessageInput as AddressInput } from "./message-input";

export const AddressForm = ({ suggestedAddress }) => {
  const [address, setAddress] = useState("");
  useEffect(() => {
    setAddress(suggestedAddress);
  }, [suggestedAddress]);

  return <form><AddressInput message={address} writeMessage={setAddress} /></form>;
};`;

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-imported-input-relay-"));
  resetFilesystemCaches();
});

afterEach(() => {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

const writeFixture = (relativePath: string, contents: string): string => {
  const filename = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
  return filename;
};

const lint = (source = app): number => {
  const filename = writeFixture("src/form.tsx", source);
  const result = runRule(noDerivedState, source, { filename });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics.length;
};

describe("no-derived-state with a setter wired through an imported input", () => {
  it("recognizes an aliased named import of a direct input function", () => {
    writeFixture("src/message-input.tsx", field);
    expect(lint()).toBe(0);
  });

  it("retains the warning for a path alias with an unproven runtime resolver", () => {
    writeFixture(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { paths: { "@ui/*": ["./src/*"] } } }),
    );
    writeFixture("src/message-input.tsx", field.replace('type="email"', 'type="search"'));
    expect(lint(app.replace('"./message-input"', '"@ui/message-input"'))).toBe(1);
  });

  it("retains the warning when the provider changes from editable to read-only", () => {
    writeFixture("src/message-input.tsx", field);
    expect(lint()).toBe(0);
    writeFixture("src/message-input.tsx", field.replace("<input", "<input readOnly"));
    expect(lint()).toBe(1);
  });

  it("discovers a provider created between scan batches", () => {
    expect(lint()).toBe(1);
    writeFixture("src/message-input.tsx", field);
    resetFilesystemCaches();
    expect(lint()).toBe(0);
  });

  it("keeps the warning when a competing extension can provide the input", () => {
    writeFixture("src/message-input.tsx", field);
    writeFixture("src/message-input.js", "export const MessageInput = () => null;");
    expect(lint()).toBe(1);
  });

  it("keeps the warning for a platform-specific provider that might be selected", () => {
    writeFixture("src/message-input.tsx", field);
    writeFixture("src/message-input.web.tsx", "export const MessageInput = () => null;");
    expect(lint()).toBe(1);
  });

  it("refreshes a changed provider whose size and modification time match", () => {
    const searchField = field.replace('type="email"', 'type="search"');
    const provider = writeFixture("src/message-input.tsx", searchField);
    const stableTime = new Date("2025-01-01T00:00:00Z");
    fs.utimesSync(provider, stableTime, stableTime);
    expect(lint()).toBe(0);
    const before = fs.statSync(provider);
    const replacement = writeFixture(
      "replacement.tsx",
      searchField.replace('type="search"', 'type="hidden"'),
    );
    fs.utimesSync(replacement, stableTime, stableTime);
    fs.renameSync(replacement, provider);
    const after = fs.statSync(provider);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    resetFilesystemCaches();
    expect(lint()).toBe(1);
  });

  it.each([
    ["an eager extra input attribute", field.replace("<input", "<input title={readLabel()}"), app],
    [
      "an eager extra consumer attribute",
      field,
      app.replace("<AddressInput", "<AddressInput title={readLabel()}"),
    ],
    [
      "a caller spread with a getter",
      field,
      app.replace(
        "<AddressInput",
        "<AddressInput {...{ get title() { throw Error('missing'); } }}",
      ),
    ],
    ["a read-only flag", field.replace("<input", "<input readOnly"), app],
    [
      "a provider returned from a mutable binding",
      field.replace("export const", "export let"),
      app,
    ],
    [
      "a setter forwarded from a different prop",
      field.replace("writeMessage(event.", "save(event."),
      app,
    ],
    ["a different controlled value", field.replace("value={message}", 'value="literal"'), app],
    ["a provider with unknown attributes", field.replace("<input", "<input {...extra}"), app],
    [
      "an imported mutable wrapper",
      'import {forwardRef} from "react";' +
        field
          .replace("= (", "= forwardRef((")
          .replace(") => (", ", ref) => (")
          .replace(/\);$/, "));"),
      app,
    ],
    [
      "a provider that exports the component by indirection",
      field.replace("export const", "const") + "\nexport { MessageInput };",
      app,
    ],
    [
      "an imported provider with public defaults",
      field
        .replace("writeMessage })", "writeMessage, locked = false })")
        .replace("<input", "<input readOnly={locked}"),
      app,
    ],
    [
      "an exported provider modified in its module",
      field + "\nMessageInput.defaultProps = { message: 'pending' };",
      app,
    ],
    [
      "an import erased at runtime",
      field,
      app.replace("import { MessageInput", "import type { MessageInput"),
    ],
    [
      "an unknown ancestor renderer",
      field,
      app.replace("<form>", "<PageSlot>").replace("</form>", "</PageSlot>"),
    ],
    [
      "a superseding caller setter spread",
      field,
      app.replace("writeMessage={setAddress}", "writeMessage={setAddress} {...settings}"),
    ],
  ])("retains the warning for %s", (_label, provider, consumer) => {
    writeFixture("src/message-input.tsx", provider);
    expect(lint(consumer)).toBe(1);
  });

  it("tracks dependency probes for every rule that uses a provider", () => {
    const consumer = writeFixture("src/form.tsx", app);
    const provider = path.join(fixtureRoot, "src/message-input.tsx");
    const ruleIds = [
      "no-derived-state",
      "no-derived-state-effect",
      "no-initialize-state",
      "no-adjust-state-on-prop-change",
    ];
    for (const ruleId of ruleIds) {
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: consumer,
        sourceText: app,
        ruleIds: [ruleId],
      });
      expect(trace?.existencePaths.has(provider)).toBe(true);
    }
    writeFixture("src/message-input.tsx", field);
    resetFilesystemCaches();
    for (const ruleId of ruleIds) {
      const trace = collectCrossFileDependencyProbes({
        absoluteFilePath: consumer,
        sourceText: app,
        ruleIds: [ruleId],
      });
      expect(trace?.contentPaths.has(provider)).toBe(true);
      expect(trace?.existencePaths.has(path.join(fixtureRoot, "src/message-input.js"))).toBe(true);
      expect(trace?.existencePaths.has(path.join(fixtureRoot, "src/message-input.web.tsx"))).toBe(
        true,
      );
    }
  });
});
