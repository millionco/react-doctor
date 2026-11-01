import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const CONTROLS = [
  {
    name: "plain-parent-own-data-field",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return records.map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
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
    name: "as-any-map-receiver",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records as any).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
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
    name: "non-null-map-receiver",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records!).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
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
    name: "nested-transparent-map-receiver",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return ((records as typeof records)!).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
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
    name: "unknown-value-cast-is-not-state-symbol",
    code: `import { useState } from "react";
export const FlagChoices = ({ incoming }: { incoming: unknown }) => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (incoming as typeof records).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "optional-state-map",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records as any)?.map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "written-handler-index",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    position = 0;
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records!).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "handler-escape",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records as any).map((record, position) => (
    <button key={position} onClick={change}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "record-replaced-before-write",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position] = { checked: false };
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records!).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "visible-map-replacement",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  records.map = customMap;
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records as any).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [
        {
          column: 2,
          line: 4,
          message:
            'React can\'t tell you changed "records" in place, so this update can be skipped or lost.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "side-effect-sequence-receiver",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (effect(), records).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unreachable-conditional-wrapped-write",
    code: `import { useState } from "react";
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    if (false) nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records as any).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "visible-global-native-map-provider-replacement",
    code: `import { useState } from "react";
Array.prototype.map = customMap;
export const FlagChoices = () => {
  const [records, setRecords] = useState([{ checked: false }]);
  const change = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].checked = true;
    setRecords(nextRecords);
  };
  return (records!).map((record, position) => (
    <button key={position} onClick={() => change(position)}>
      {String(record.checked)}
    </button>
  ));
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
];

const RUN_RULE_OPTIONS = {
  filename: "synthetic-state-map-receiver-transparency.tsx",
  includeLocations: true,
};

describe("no-direct-state-mutation transparent state map receivers", () => {
  it.each(CONTROLS)("$name", ({ code, expectedResult }) => {
    expect(runRule(noDirectStateMutation, code, RUN_RULE_OPTIONS)).toEqual(expectedResult);
  });
});
