import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDirectStateMutation } from "./no-direct-state-mutation.js";

const CONTROLS = [
  {
    name: "closed-empty-append-filter-value-map",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 9,
          column: 4,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "numeric-values-are-not-required-to-be-in-bounds",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const reset = () => setRecords([]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => String(position));
  return <section title={labels.join(",")} onDoubleClick={reset}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 10,
          column: 4,
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
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position] = { ...nextRecords[position], active: true };
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unknown-setter-feed-despite-number-annotation",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = ({ values }: { values: number[] }) => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>(values);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "selected-array-opaque-escape",
    code: `import { useState } from "react";
import { consume } from "consumer";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  consume(chosen);
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "direct-list-element-write",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  chosen[0] = 0;
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 13,
          column: 2,
          message:
            'React can\'t tell you changed "chosen" in place, so this update can be skipped or lost.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "mutating-filter-third-argument",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value, index, values) => { values[index] = 0; return value !== position; }));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "extra-opaque-handler-invocation",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = ({ incoming }: { incoming: number }) => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  remove(incoming);
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "visible-aliased-native-provider-replacement",
    code: `import { useState } from "react";
const { constructor: NativeArray } = [];
NativeArray.prototype.filter = () => ["other"];
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "unreachable-shared-write",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    if (false) nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "object-key-coercion-detaches-before-field-write",
    code: `import { useState } from "react";
let detachedCopy;
const coerciveIndex = {
  toString: () => {
    detachedCopy[0] = { ...detachedCopy[0] };
    return "0";
  },
};
export const CoercionTrap = () => {
  const [records, setRecords] = useState([{ label: "one", active: false }]);
  const [chosen] = useState([coerciveIndex]);
  const remove = (position) => {
    const nextRecords = [...records];
    detachedCopy = nextRecords;
    nextRecords[position].active = true;
    setRecords(nextRecords);
  };
  return chosen.map((position) => <button onClick={() => remove(position)}>Remove</button>);
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "object-pattern-only-filter-replacement-returns-throwing-coercive-key",
    code: `import { useState } from "react";
const { constructor: NativeObject } = {};
const { defineProperty: install } = NativeObject;
const { constructor: NativeArray } = [];
const { prototype: arrayPrototype } = NativeArray;
const coerciveKey = { toString: () => { throw Error("key conversion"); } };
install(arrayPrototype, "filter", { value: () => [coerciveKey] });
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "functional-scalar-updater",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen((previous) => [...previous, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "scalar-setter-escape",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  expose(setChosen);
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "noncanonical-scalar-append",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, 0]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "map-third-array-parameter",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position, ordinal, array) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "written-map-value-parameter",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position = 0)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "scalar-list-mutator",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  chosen.push(0);
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 13,
          column: 2,
          message:
            'React can\'t tell .push() changed "chosen" in place, so this update can be skipped or lost.',
          nodeType: "CallExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "filter-opaque-predicate",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => predicate(value, position)));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "filter-boolean-truthiness",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter(Boolean));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "optional-scalar-map",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen?.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "handler-escaping-as-event",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={remove}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "readonly-id-props",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = ({ id }: { id: string }) => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section id={id} title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 9,
          column: 4,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "absent-field-composes-only-existing54-field-contract",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].extra = "new";
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 9,
          column: 4,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "different-array-map-value",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = ({ incoming }: { incoming: number[] }) => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {incoming.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "no-append-grounding",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen(chosen.filter((value) => value !== position));
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [],
      parseErrors: [],
    },
  },
  {
    name: "wrapped-new-index-receiver",
    code: `import { useState } from "react";
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => setChosen([...chosen, position]);
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {(chosen as number[]).map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 9,
          column: 4,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
  {
    name: "old-canonical-path-survives-numeric-provider-veto",
    code: `import { useState } from "react";
const { constructor: NativeObject } = {};
interface ChoiceRecord { label: string; active: boolean; }
export const Choices = () => {
  const [records, setRecords] = useState<ChoiceRecord[]>([{ label: "one", active: false }]);
  const [chosen, setChosen] = useState<number[]>([]);
  const add = (position: number) => {
    const copy = [...records];
    copy[position].active = true;
    setRecords(copy);
    setChosen([...chosen, position]);
  };
  const remove = (position: number) => {
    const nextRecords = [...records];
    nextRecords[position].active = true;
    setChosen(chosen.filter((value) => value !== position));
    setRecords(nextRecords);
  };
  const labels = chosen.map((position) => records[position].label);
  return <section title={labels.join(",")}>
    {records.map((record, position) => <button key={position} onClick={() => add(position)}>{record.label}</button>)}
    {chosen.map((position) => <button key={position} onClick={() => remove(position)}>Remove</button>)}
  </section>;
};
`,
    expectedResult: {
      diagnostics: [
        {
          line: 9,
          column: 4,
          message:
            'Copying the array still shares its records with "records". Replace the changed record instead of changing it in place.',
          nodeType: "AssignmentExpression",
        },
      ],
      parseErrors: [],
    },
  },
];

const RUN_RULE_OPTIONS = {
  filename: "synthetic-closed-numeric-selection-list.tsx",
  includeLocations: true,
  settings: {
    "react-doctor": {
      portedRuleMode: "curated",
      capabilities: ["react"],
    },
  },
};

describe("no-direct-state-mutation closed numeric selection list transport", () => {
  it.each(CONTROLS)("$name", ({ code, expectedResult }) => {
    expect(runRule(noDirectStateMutation, code, RUN_RULE_OPTIONS)).toEqual(expectedResult);
  });
});
