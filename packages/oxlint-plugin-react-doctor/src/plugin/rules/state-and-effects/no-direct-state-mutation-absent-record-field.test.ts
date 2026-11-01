import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const CONTROLS = [
  {
    name: "add-absent-static-data-key",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
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
    name: "existing-own-data-key-control",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one", extra: "old" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
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
    name: "immutable-record-replacement",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index] = { ...copy[index], extra: "new" };
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "visible-inherited-setter",
    code: `import { useState } from "react";
Object.defineProperty(Object.prototype, "extra", { set(value) {} });
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "accessor-producer",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ get label() { return "one"; } }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "opaque-additional-feed",
    code: `import { useState } from "react";
export const RecordPicker = (props: { incoming: Array<{ label: string }> }) => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const refresh = () => setRecords(props.incoming);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div><button onClick={refresh}>Refresh</button>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "dynamic-field-key",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number, key: string) => {
    const copy = [...records];
    copy[index][key] = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index, "extra")}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "prototype-protocol-key",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].__proto__ = null;
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "separate-scalar-index-list-transport",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const [indices] = useState([0]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record) => <span>{record.label}</span>)}{indices.map((value) => <button onClick={() => write(value)}>Update</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "record-array-escape",
    code: `import { useState } from "react";
export const RecordPicker = (props: { publish: (rows: unknown[]) => void }) => {
  const [records, setRecords] = useState([{ label: "one" }]);
  props.publish(records);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "destructured-inherited-native-object-constructor",
    code: `import { useState } from "react";
const { constructor: NativeObject } = {};
NativeObject.defineProperty(NativeObject.getPrototypeOf({}), "extra", { set(value) {} });
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "computed-literal-constructor-pattern",
    code: `import { useState } from "react";
const { ["constructor"]: NativeObject } = {};
NativeObject.defineProperty(NativeObject.getPrototypeOf({}), "extra", { set(value) {} });
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "computed-variable-constructor-pattern",
    code: `import { useState } from "react";
const providerKey = "constructor";
const { [providerKey]: NativeObject } = {};
NativeObject.defineProperty(NativeObject.getPrototypeOf({}), "extra", { set(value) {} });
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "rest-aliased-reflection-provider",
    code: `import { useState } from "react";
const { constructor: NativeObject } = {};
const { ...reflectionProvider } = { defineProperty: NativeObject.defineProperty, getPrototypeOf: NativeObject.getPrototypeOf };
reflectionProvider.defineProperty(reflectionProvider.getPrototypeOf({}), "extra", { set(value) {} });
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "opaque-props-reflection-provider",
    code: `import { useState } from "react";
export const RecordPicker = (props: { provider: { defineProperty: (...args: any[]) => unknown; getPrototypeOf: (value: object) => object } }) => {
  props.provider.defineProperty(props.provider.getPrototypeOf({}), "extra", { set(value) {} });
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "ordinary-id-props-retains-eligibility",
    code: `import { useState } from "react";
export const RecordPicker = ({ id }: { id: string }) => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div id={id}>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
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
    name: "mixed-present-and-absent-record-producers",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }, { label: "two", extra: "old" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unreachable-absent-key-write",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    if (false) { copy[index].extra = "new"; }
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "old-own-data-key-survives-new-only-provider-veto",
    code: `import { useState } from "react";
const { constructor: NativeObject } = {};
NativeObject.defineProperty(NativeObject.getPrototypeOf({}), "extra", { set(value) {} });
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one", extra: "old" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].extra = "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
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
    name: "inherited-object-prototype-key",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].hasOwnProperty = () => false;
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "promise-then-protocol-key",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].then = () => {};
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "json-protocol-key",
    code: `import { useState } from "react";
export const RecordPicker = () => {
  const [records, setRecords] = useState([{ label: "one" }]);
  const write = (index: number) => {
    const copy = [...records];
    copy[index].toJSON = () => "new";
    setRecords(copy);
  };
  return <div>{records.map((record, index) => <button key={index} onClick={() => write(index)}>{record.label}</button>)}</div>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
];

const RUN_RULE_OPTIONS = {
  filename: "synthetic-static-state-record-field.tsx",
  includeLocations: true,
};

describe("no-direct-state-mutation ordinary absent record field", () => {
  it.each(CONTROLS)("$name", ({ code, expectedResult }) => {
    expect(runRule(noDirectStateMutation, code, RUN_RULE_OPTIONS)).toEqual(expectedResult);
  });
});
