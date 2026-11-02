import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noEffectChain } from "./no-effect-chain.js";

interface SelectionChainExpectedEdge {
  readonly state: string;
  readonly marker: string;
}

interface SelectionChainIntegrationFixture {
  readonly name: string;
  readonly source: string;
  readonly files: Readonly<Record<string, string>>;
  readonly expected: ReadonlyArray<SelectionChainExpectedEdge>;
}

const BASE_SOURCE =
  "\nimport { useEffect, useRef, useState } from 'react';\nconst EMPTY_POSITION = -3;\nfunction ChoiceField({ entries = [], onPick = () => {}, enabled = true }) {\n  const [chosen, setChosen] = useState('');\n  const [choices, setChoices] = useState(entries);\n  const [opened, setOpened] = useState(false);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const wrapper = useRef(null);\n  const field = useRef(null);\n  const finish = () => {\n    const target = field.current;\n    if (target) {\n      target.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  };\n  useEffect(() => { setPosition(2); setOpened(true); }, [entries]);\n  useEffect(() => {\n    if (opened && position !== EMPTY_POSITION && enabled) {\n      setChosen(choices[position]);\n      onPick(choices[position]);\n      setOpened(false);\n      finish();\n    }\n  }, [position, other]);\n  return <div ref={wrapper}><label>Choice</label><input ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></div>;\n}\n";
const STYLED_SOURCE =
  "\nimport { useEffect, useRef, useState } from 'react';\nimport { Field, Frame, Caption } from \"./parts\";\nconst EMPTY_POSITION = -3;\nfunction ChoiceField({ entries = [], onPick = () => {}, enabled = true }) {\n  const [chosen, setChosen] = useState('');\n  const [choices, setChoices] = useState(entries);\n  const [opened, setOpened] = useState(false);\n  const [position, setPosition] = useState(EMPTY_POSITION);\n  const [other, setOther] = useState(0);\n  const [total, setTotal] = useState(0);\n  const wrapper = useRef(null);\n  const field = useRef(null);\n  const finish = () => {\n    const target = field.current;\n    if (target) {\n      target.focus();\n      setPosition(EMPTY_POSITION);\n    }\n  };\n  useEffect(() => { setPosition(2); setOpened(true); }, [entries]);\n  useEffect(() => {\n    if (opened && position !== EMPTY_POSITION && enabled) {\n      setChosen(choices[position]);\n      onPick(choices[position]);\n      setOpened(false);\n      finish();\n    }\n  }, [position, other]);\n  return <Frame ref={wrapper}><Caption>Choice</Caption><Field ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></Frame>;\n}\n";
const STYLED_FILES: Readonly<Record<string, string>> = {
  "parts/index.ts": 'export { Field, Frame, Caption } from "./hosts";',
  "parts/hosts.tsx":
    'import styled from "styled-components"; export const Field = styled.input.attrs(({ theme, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``; export const Frame = styled.div``; export const Caption = styled.label``;',
};

const INCOMING_SOURCE = BASE_SOURCE.replace(
  "useEffect(() => { setPosition(2); setOpened(true); }, [entries]);",
  "useEffect(() => { setPosition(2); setOpened(true); setOther(1); }, [entries]);",
).replace(
  "    if (opened && position !== EMPTY_POSITION && enabled) {",
  "    if (opened && position !== EMPTY_POSITION && enabled && other === 1) {",
);

const fixtures: ReadonlyArray<SelectionChainIntegrationFixture> = [
  {
    name: "native input selection reset removes only its index chain",
    source: BASE_SOURCE,
    files: {},
    expected: [],
  },
  {
    name: "native fixed child selection reset removes only its index chain",
    source: BASE_SOURCE.replace(
      "const target = field.current;",
      "const target = wrapper.current.children[1];",
    ),
    files: {},
    expected: [],
  },
  {
    name: "relative styled hosts and named barrel remove the index chain",
    source: STYLED_SOURCE,
    files: STYLED_FILES,
    expected: [],
  },
  {
    name: "relative styled fixed child removes the index chain",
    source: STYLED_SOURCE.replace(
      "const target = field.current;",
      "const target = wrapper.current.children[1];",
    ),
    files: STYLED_FILES,
    expected: [],
  },
  {
    name: "derived total from the same index beside focus keeps its warning",
    source: BASE_SOURCE.replace(
      "      finish();",
      "      setTotal(position * 5);\n      finish();",
    ),
    files: {},
    expected: [{ state: "position", marker: "  useEffect(() => {\n    if" }],
  },
  {
    name: "custom ref host keeps the index chain warning",
    source: BASE_SOURCE.replace("<input ref={field}", "<CustomField ref={field}"),
    files: {},
    expected: [{ state: "position", marker: "  useEffect(() => {\n    if" }],
  },
  {
    name: "overridden styled host keeps the index chain warning",
    source: STYLED_SOURCE,
    files: {
      "parts/index.ts": 'export { Field, Frame, Caption } from "./hosts";',
      "parts/hosts.tsx":
        'import styled from "styled-components"; export const Field = styled.input.attrs(({ theme, ...rest }) => ({ theme: { ...theme }, tone: "plain", ...rest }))``; export const Frame = styled.div``; export const Caption = styled.label``;\nField.defaultProps = { as: "custom-host" };',
    },
    expected: [{ state: "position", marker: "  useEffect(() => {\n    if" }],
  },
  {
    name: "independent incoming state remains reported",
    source: INCOMING_SOURCE,
    files: {},
    expected: [{ state: "other", marker: "  useEffect(() => {\n    if" }],
  },
  {
    name: "downstream chosen state remains reported",
    source: BASE_SOURCE.replace(
      "  return <div ref={wrapper}><label>Choice</label><input ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></div>;",
      "  useEffect(() => { setTotal(chosen.length); }, [chosen]);\n  return <div ref={wrapper}><label>Choice</label><input ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></div>;",
    ),
    files: {},
    expected: [
      { state: "chosen", marker: "  useEffect(() => { setTotal(chosen.length); }, [chosen]);" },
    ],
  },
  {
    name: "incoming and downstream edges both remain reported",
    source: INCOMING_SOURCE.replace(
      "  return <div ref={wrapper}><label>Choice</label><input ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></div>;",
      "  useEffect(() => { setTotal(chosen.length); }, [chosen]);\n  return <div ref={wrapper}><label>Choice</label><input ref={field} value={chosen} onChange={event => setChosen(event.target.value)} /></div>;",
    ),
    files: {},
    expected: [
      { state: "other", marker: "  useEffect(() => {\n    if" },
      { state: "chosen", marker: "  useEffect(() => { setTotal(chosen.length); }, [chosen]);" },
    ],
  },
];

describe("noEffectChain owned input selection and focus", () => {
  it.each(fixtures)("$name", (fixture) => {
    const root = fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "selection-chain-integration-"),
    );
    try {
      const filename = path.join(root, "choice-field.tsx");
      const packageBody = JSON.stringify({
        private: true,
        dependencies: { react: "18.2.0", "react-dom": "18.2.0", "styled-components": "5.3.11" },
      });
      for (const [relativePath, body] of Object.entries({
        "package.json": packageBody,
        ...fixture.files,
        "choice-field.tsx": fixture.source,
      })) {
        const destination = path.join(root, relativePath);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, body);
      }
      resetFilesystemCaches();
      const result = runRule(noEffectChain, fixture.source, { filename, includeLocations: true });
      expect(result.parseErrors).toEqual([]);
      const expected = fixture.expected.map((edge) => {
        const offset = fixture.source.indexOf(edge.marker);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(fixture.source.lastIndexOf(edge.marker)).toBe(offset);
        return {
          line: fixture.source.slice(0, offset).split("\n").length,
          message: `Your screen redraws several times from a single action because one useEffect changes "${edge.state}", which sets off this one.`,
        };
      });
      expect(
        result.diagnostics.map((diagnostic) => ({
          line: diagnostic.line,
          message: diagnostic.message,
        })),
      ).toEqual(expected);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      resetFilesystemCaches();
    }
  });
});
