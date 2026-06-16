import { describe, expect, it } from "vite-plus/test";
import { OxlintBatchExceeded, OxlintOutputUnparseable, ReactDoctorError } from "../src/errors.js";
import { reactHooksJsPluginDropNote } from "../src/run-oxlint.js";

// oxlint prints this framed block to stdout (not stderr) and exits
// non-zero when a `jsPlugins` entry can't be imported. `parseOxlintOutput`
// can't JSON-parse it, so it surfaces as `OxlintOutputUnparseable` whose
// `preview` is the start of that block. See issue #833.
const buildPreview = (specifier: string, reason: string): string =>
  `Failed to parse oxlint configuration file.\n\n  x Failed to load JS plugin: ${specifier}\n  |   ${reason}`;

const reactHooksSpecifier =
  "/repo/node_modules/.pnpm/eslint-plugin-react-hooks@7.1.1_eslint@9.39.4_jiti@2.7.0_/node_modules/eslint-plugin-react-hooks/index.js";

const unparseable = (preview: string): ReactDoctorError =>
  new ReactDoctorError({ reason: new OxlintOutputUnparseable({ preview }) });

describe("reactHooksJsPluginDropNote", () => {
  it("recognizes a react-hooks-js load failure and surfaces the underlying reason", () => {
    const error = unparseable(
      buildPreview(
        reactHooksSpecifier,
        "Error: Cannot find module './cjs/eslint-plugin-react-hooks.development.js'",
      ),
    );

    const note = reactHooksJsPluginDropNote(error);

    expect(note).toContain("React Compiler rules (react-hooks-js/*) skipped");
    expect(note).toContain(
      "Error: Cannot find module './cjs/eslint-plugin-react-hooks.development.js'",
    );
    expect(note).toContain("Other rules ran normally.");
  });

  it("still recognizes the failure when the preview is truncated before the reason line", () => {
    // The historical bug: a short `preview` cut the path at `…/node_modules/`,
    // which looked like react-doctor passing an invalid directory. The
    // markers still survive, so the failure is detected; the reason is just
    // omitted from the note.
    const truncated =
      "Failed to parse oxlint configuration file.\n\n  x Failed to load JS plugin: /repo/node_modules/.pnpm/eslint-plugin-react-hooks@7.1.1_/node_modules/";

    const note = reactHooksJsPluginDropNote(unparseable(truncated));

    expect(note).toBe(
      "React Compiler rules (react-hooks-js/*) skipped — eslint-plugin-react-hooks failed to load in this environment. Other rules ran normally.",
    );
  });

  it("returns null for a JS-plugin failure in some OTHER plugin", () => {
    const error = unparseable(
      buildPreview("/repo/node_modules/eslint-plugin-import/index.js", "Error: boom"),
    );

    expect(reactHooksJsPluginDropNote(error)).toBeNull();
  });

  it("returns null when the failure is not a JS-plugin load failure", () => {
    const error = unparseable(
      "Some other oxlint configuration error mentioning eslint-plugin-react-hooks",
    );

    expect(reactHooksJsPluginDropNote(error)).toBeNull();
  });

  it("returns null for non-OxlintOutputUnparseable errors", () => {
    const splittable = new ReactDoctorError({
      reason: new OxlintBatchExceeded({ kind: "timeout", detail: "5s budget exceeded" }),
    });

    expect(reactHooksJsPluginDropNote(splittable)).toBeNull();
    expect(reactHooksJsPluginDropNote(new Error("plain error"))).toBeNull();
    expect(reactHooksJsPluginDropNote(null)).toBeNull();
  });
});
