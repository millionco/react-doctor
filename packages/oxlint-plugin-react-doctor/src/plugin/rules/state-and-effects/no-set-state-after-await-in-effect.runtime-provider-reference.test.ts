import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

const cases = [
  {
    name: "useRef-unmasked",
    code: '\nimport { useEffect, useRef, useState } from "react";\n\nconst NativeGenerationSnapshot = ({ id, load }) => {\n  const [value, setValue] = useState(null);\n  const sequence = useRef(0);\n  const callback = async () => {\n    const snapshot = sequence.current;\n    await load(id);\n    if (snapshot === sequence.current) setValue(id);\n  };\n  const holder = useRef(callback);\n  useEffect(() => {\n    holder.current = callback;\n  }, [callback]);\n  useEffect(() => {\n    sequence.current++;\n    callback();\n  }, [id]);\n  return <output>{value}</output>;\n};import {mutate} from "./external";function expose(){mutate(useRef);}expose();',
    expectedCount: 1,
  },
  {
    name: "useRef-interface",
    code: '\nimport { useEffect, useRef, useState } from "react";\n\nconst NativeGenerationSnapshot = ({ id, load }) => {\n  const [value, setValue] = useState(null);\n  const sequence = useRef(0);\n  const callback = async () => {\n    const snapshot = sequence.current;\n    await load(id);\n    if (snapshot === sequence.current) setValue(id);\n  };\n  const holder = useRef(callback);\n  useEffect(() => {\n    holder.current = callback;\n  }, [callback]);\n  useEffect(() => {\n    sequence.current++;\n    callback();\n  }, [id]);\n  return <output>{value}</output>;\n};import {mutate} from "./external";function expose(){interface useRef {}mutate(useRef);}expose();',
    expectedCount: 1,
  },
  {
    name: "useRef-type-alias",
    code: '\nimport { useEffect, useRef, useState } from "react";\n\nconst NativeGenerationSnapshot = ({ id, load }) => {\n  const [value, setValue] = useState(null);\n  const sequence = useRef(0);\n  const callback = async () => {\n    const snapshot = sequence.current;\n    await load(id);\n    if (snapshot === sequence.current) setValue(id);\n  };\n  const holder = useRef(callback);\n  useEffect(() => {\n    holder.current = callback;\n  }, [callback]);\n  useEffect(() => {\n    sequence.current++;\n    callback();\n  }, [id]);\n  return <output>{value}</output>;\n};import {mutate} from "./external";function expose(){type useRef=unknown;mutate(useRef);}expose();',
    expectedCount: 1,
  },
  {
    name: "useRef-real-local-interface",
    code: '\nimport { useEffect, useRef, useState } from "react";\n\nconst NativeGenerationSnapshot = ({ id, load }) => {\n  const [value, setValue] = useState(null);\n  const sequence = useRef(0);\n  const callback = async () => {\n    const snapshot = sequence.current;\n    await load(id);\n    if (snapshot === sequence.current) setValue(id);\n  };\n  const holder = useRef(callback);\n  useEffect(() => {\n    holder.current = callback;\n  }, [callback]);\n  useEffect(() => {\n    sequence.current++;\n    callback();\n  }, [id]);\n  return <output>{value}</output>;\n};import {mutate} from "./external";function expose(){const useRef=()=>({current:0});interface useRef {}mutate(useRef);}expose();',
    expectedCount: 0,
  },
];

describe("no-set-state-after-await-in-effect runtime provider references", () => {
  it.each(cases)("$name", ({ code, expectedCount }) => {
    const result = runRule(noSetStateAfterAwaitInEffect, code, {
      filename: "/tmp/rd-runtime-provider-references/view.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
