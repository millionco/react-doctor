import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const CASES = [
  {
    name: "nominal-absent-field",
    code: 'import { useState } from "react";\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 6,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "type-only-reflection-pattern",
    code: 'import { useState } from "react";\ntype ReflectionNote = ({ constructor }: { constructor: string }) => void;\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "visible-inherited-setter-eval",
    code: 'import { useState } from "react";\nglobalThis.eval(\'Object.defineProperty(Object.prototype,"extra",{set(value){void value;},configurable:true})\');\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "erased-global-this-inherited-setter",
    code: 'import { useState } from "react";\ninterface globalThis {}\nglobalThis.eval(\'Object.defineProperty(Object.prototype,"extra",{set(value){void value;},configurable:true})\');\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "real-local-global-this-noop",
    code: 'import { useState } from "react";\nconst globalThis = { eval: (_code: string) => {} };\nglobalThis.eval(\'Object.defineProperty(Object.prototype,"extra",{set(value){void value;},configurable:true})\');\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 8,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "erased-hook-import",
    code: 'import { useState } from "react";\nexport const RecordPicker = () => {\n  interface useState {}\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "erased-index-parameter",
    code: 'import { useState } from "react";\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    interface index {}\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "erased-copy-binding",
    code: 'import { useState } from "react";\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    interface copy {}\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "unused-erased-global-name",
    code: 'import { useState } from "react";\ninterface globalThis {}\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "runtime-global-companion",
    code: 'import { useState } from "react";\ninterface globalThis {}\nconst globalThis = { eval: (_code: string) => {} };\nglobalThis.eval(\'Object.defineProperty(Object.prototype,"extra",{set(value){void value;},configurable:true})\');\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 9,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "nested-type-only-reflection-pattern",
    code: 'import { useState } from "react";\ntype ReflectionNote = ({ nested: { constructor } }: { nested: { constructor: string } }) => void;\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "runtime-nested-reflection-pattern",
    code: 'import { useState } from "react";\nconst readReflection = ({ nested: { constructor } }: { nested: { constructor: string } }) => constructor;\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "runtime-parameter-property-provider",
    code: 'import { useState } from "react";\ndeclare const provider: { defineProperty(): number };\nclass Setup { constructor(public value = provider.defineProperty()) {} }\nnew Setup();\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "runtime-enum-provider",
    code: 'import { useState } from "react";\ndeclare const provider: { defineProperty(): number };\nenum Setup { Value = provider.defineProperty() }\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "runtime-namespace-provider",
    code: 'import { useState } from "react";\ndeclare const provider: { defineProperty(): number };\nnamespace Setup { export const value = provider.defineProperty(); }\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "runtime-parameter-property-function-provider",
    code: 'import { useState } from "react";\nclass Setup { constructor(public value = Function("Object.defineProperty(Object.prototype, \'extra\', { set() {}, configurable: true })")()) {} }\nnew Setup();\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "as-any-receiver",
    code: 'import { useState } from "react";\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    interface index {}\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{(records as any).map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "non-null-receiver",
    code: 'import { useState } from "react";\nexport const RecordPicker = () => {\n  const [records, setRecords] = useState([{ label: "one" }]);\n  const write = (index: number) => {\n    interface index {}\n    const copy = [...records];\n    copy[index].extra = "new";\n    setRecords(copy);\n  };\n  return <div>{(records!).map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;\n};\n',
    expectedResult: {
      diagnostics: [
        {
          column: 4,
          line: 7,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
];

describe("no-direct-state-mutation absent record runtime bindings", () => {
  it.each(CASES)("$name", ({ code, expectedResult }) => {
    expect(
      runRule(noDirectStateMutation, code, {
        filename: "synthetic-absent-record-runtime.tsx",
        includeLocations: true,
      }),
    ).toEqual(expectedResult);
  });
});
