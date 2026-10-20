import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../utils/reset-filesystem-caches.js";
import { noDerivedUseState } from "./no-derived-use-state.js";

interface KeyedDraftFixture {
  name: string;
  code: string;
  filename: string;
  diagnostics: ReturnType<typeof runRule>["diagnostics"];
}

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "keyed-draft-"));
  resetFilesystemCaches();
});

afterEach(() => {
  resetFilesystemCaches();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFixture = (relativePath: string, source: string): string => {
  const filename = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, source);
  return filename;
};

const fixedCases: KeyedDraftFixture[] = [
  {
    name: "closed-private-keyed-editable-form",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
    filename: "keyed-edit-00.tsx",
    diagnostics: [],
  },
  {
    name: "missing-parent-key",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm entity={entity}/>;",
    filename: "keyed-edit-01.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "inner-key-only",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input key={entity.slug} value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm entity={entity}/>;",
    filename: "keyed-edit-02.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "unrelated-key",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key=\"constant\" entity={entity}/>;",
    filename: "keyed-edit-03.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "later-spread-can-override-prop",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity,extra}:{entity:Entity;extra:object})=><EditForm key={entity.slug} entity={entity} {...extra}/>;",
    filename: "keyed-edit-04.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "second-unkeyed-use",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nexport const Other=({entity}:{entity:Entity})=><EditForm entity={entity}/>;",
    filename: "keyed-edit-05.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "exported-child-open-consumers",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nexport const EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
    filename: "keyed-edit-06.tsx",
    diagnostics: [
      {
        column: 74,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "component-alias-escape",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nregister(EditForm);",
    filename: "keyed-edit-07.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "direct-component-call",
    code: 'import {useState} from \'react\';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nEditForm({entity:{slug:"one",label:"label"}});',
    filename: "keyed-edit-08.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "display-only-copy",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <span>{draft}</span>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
    filename: "keyed-edit-09.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "setter-escape",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);expose(setDraft);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
    filename: "keyed-edit-10.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "duplicate-key",
    code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} key=\"other\" entity={entity}/>;",
    filename: "keyed-edit-11.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "coercible-key-domain",
    code: "import {useState} from 'react';\ninterface Entity {slug:string|number;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
    filename: "keyed-edit-12.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "react-provider-override",
    code: "import React,{useState} from 'react';React.createElement=fake;\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
    filename: "keyed-edit-13.tsx",
    diagnostics: [
      {
        column: 67,
        line: 3,
        message:
          'Your users see a stale value when prop "entity" changes because useState copies it once.',
        nodeType: "CallExpression",
      },
    ],
  },
];

const editableSource = fixedCases[0].code;
const inputControl = "<input value={draft} onChange={event=>setDraft(event.target.value)}/>";
const stringRecord = "interface Entity {slug:string;label:string}";
const expectedWarning = {
  message:
    'Your users see a stale value when prop "entity" changes because useState copies it once.',
  nodeType: "CallExpression",
};

const checkDraft = (source: string, warningCount: number): void => {
  const filename = writeFixture("src/screen.tsx", source);
  const result = runRule(noDerivedUseState, source, { filename });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual(warningCount === 0 ? [] : [expectedWarning]);
};

const withControl = (control: string, imports = ""): string =>
  imports + editableSource.replace(inputControl, control);

const writeInputWrapper = (): void => {
  writeFixture(
    "src/field-input.tsx",
    `
    import { Input as BaseInput } from '@base-ui/react/input';
    export const FieldInput = ({className,...props}) => <BaseInput className={className} {...props}/>;
  `,
  );
};

const writeSelectWrapper = (): void => {
  writeFixture(
    "src/field-select.tsx",
    `
    import { Select as BaseSelect } from '@base-ui/react/select';
    export const FieldSelect = BaseSelect.Root;
  `,
  );
};

describe("no-derived-useState — keyed editable drafts preserve same-identity edits", () => {
  for (const fixture of fixedCases) {
    it(fixture.name, () => {
      const filename = writeFixture(fixture.filename, fixture.code);
      const result = runRule(noDerivedUseState, fixture.code, { filename, includeLocations: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual(fixture.diagnostics);
    });
  }

  it("accepts an authoritative native textarea", () => {
    checkDraft(
      withControl("<textarea value={draft} onChange={event=>setDraft(event.target.value)}/>"),
      0,
    );
  });

  it("accepts a private native wrapper forwarding the remaining props", () => {
    checkDraft(
      withControl(
        "<FieldArea value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "const FieldArea=({className,...props})=><textarea className={className} {...props}/>;\n",
      ),
      0,
    );
  });

  it("accepts the imported BaseUI Input controlled API", () => {
    checkDraft(
      withControl(
        "<BaseInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {Input as BaseInput} from '@base-ui/react/input';\n",
      ),
      0,
    );
  });

  it("accepts a readonly local alias of the BaseUI Input", () => {
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {Input as BaseInput} from '@base-ui/react/input';const FieldInput=BaseInput;\n",
      ),
      0,
    );
  });

  it("accepts BaseUI Select.Root with its controlled value callback", () => {
    checkDraft(
      withControl(
        "<BaseSelect.Root value={draft} onValueChange={value=>setDraft(value??'')}/>",
        "import {Select as BaseSelect} from '@base-ui/react/select';\n",
      ),
      0,
    );
  });

  it("accepts a resolved local Input wrapper", () => {
    writeInputWrapper();
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {FieldInput} from './field-input';\n",
      ),
      0,
    );
  });

  it("accepts a resolved local Select.Root alias", () => {
    writeSelectWrapper();
    checkDraft(
      withControl(
        "<FieldSelect value={draft} onValueChange={value=>setDraft(value??'')}/>",
        "import {FieldSelect} from './field-select';\n",
      ),
      0,
    );
  });

  it("resolves a flat imported string record through the project alias", () => {
    writeFixture(
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    );
    writeFixture("src/domain/entity.ts", "export interface Entity {slug:string;label:string}");
    checkDraft(
      editableSource.replace(stringRecord, "import type {Entity} from '@/domain/entity';"),
      0,
    );
  });

  it("retains a copy whose record does not declare the selected field", () => {
    checkDraft(editableSource.replace(stringRecord, "interface Entity {slug:string}"), 1);
  });

  it("retains a copy of a nonstring field", () => {
    checkDraft(editableSource.replace("label:string", "label:number"), 1);
  });

  it("retains a copy of an optional field", () => {
    checkDraft(editableSource.replace("label:string", "label?:string"), 1);
  });

  it("declines merged record declarations", () => {
    checkDraft(
      editableSource.replace(
        stringRecord,
        "interface Entity {slug:string} interface Entity {label:string}",
      ),
      1,
    );
  });

  it("declines a nearer generic with the record declaration name", () => {
    checkDraft(editableSource.replace("const EditForm=(", "const EditForm=<Entity,>("), 1);
  });

  it("declines an edit callback with a defaulted event parameter", () => {
    checkDraft(
      editableSource.replace("event=>setDraft", '(event={target:{value:"fallback"}})=>setDraft'),
      1,
    );
  });

  it("retains a setter escaping through a computed catch pattern", () => {
    checkDraft(
      editableSource.replace(
        "return <input",
        "try{throw {}}catch({[expose(setDraft)]:ignored}){}return <input",
      ),
      1,
    );
  });

  it("declines dynamic evaluation inside a computed catch pattern", () => {
    checkDraft(
      editableSource.replace(
        "return <input",
        `try{throw {}}catch({[eval("entity.label='changed'")]:ignored}){}return <input`,
      ),
      1,
    );
  });

  it("declines an erased same-name declaration hiding a setter escape", () => {
    checkDraft(
      editableSource.replace(
        "return <input",
        "type setDraft=unknown;expose(setDraft);return <input",
      ),
      1,
    );
  });

  it("retains an editor escaping through a default parameter", () => {
    checkDraft(
      editableSource + "\nconst capture=(component=EditForm)=>component;expose(capture);",
      1,
    );
  });

  it("retains an editor escaping through a computed catch pattern", () => {
    checkDraft(editableSource + "\ntry{throw {}}catch({[expose(EditForm)]:ignored}){}", 1);
  });

  it("declines a written BaseUI provider alias", () => {
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {Input as BaseInput} from '@base-ui/react/input';let FieldInput=BaseInput;FieldInput=fake;\n",
      ),
      1,
    );
  });

  it("declines a BaseUI alias escaping through an omitted catch reference", () => {
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {Input as BaseInput} from '@base-ui/react/input';const FieldInput=BaseInput;try{throw {}}catch({[consume(FieldInput)]:ignored}){}\n",
      ),
      1,
    );
  });

  it("declines a later spread overriding the controlled input pair", () => {
    checkDraft(
      withControl(
        "<input value={draft} onChange={event=>setDraft(event.target.value)} {...extra}/>",
      ),
      1,
    );
  });

  it.each([
    "React.createElement=fake;",
    "import * as jsxRuntime from 'react/jsx-runtime';jsxRuntime.jsx=fake;",
    "require('react').createElement=fake;",
  ])("declines a visible alternate JSX provider: %s", (provider) => {
    checkDraft(provider + editableSource, 1);
  });

  it("declines a hidden input even when a change callback is declared", () => {
    checkDraft(
      withControl(
        '<input type="hidden" value={draft} onChange={event=>setDraft(event.target.value)}/>',
      ),
      1,
    );
  });

  it.each(["readOnly", "disabled", "hidden", 'type="hidden"'])(
    "declines a noneditable wrapper control: %s",
    (attribute) => {
      writeFixture(
        "src/field-input.tsx",
        `import {Input as BaseInput} from '@base-ui/react/input';export const FieldInput=({...props})=><BaseInput ${attribute} {...props}/>;`,
      );
      checkDraft(
        withControl(
          "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
          "import {FieldInput} from './field-input';\n",
        ),
        1,
      );
    },
  );

  it("accepts a wrapper forwarding an absent input type without a default", () => {
    writeFixture(
      "src/field-input.tsx",
      "import {Input as BaseInput} from '@base-ui/react/input';export const FieldInput=({type,...props})=><BaseInput type={type} {...props}/>;",
    );
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {FieldInput} from './field-input';\n",
      ),
      0,
    );
  });

  it("keeps an editable draft that is also committed through a shorthand field", () => {
    checkDraft(
      editableSource.replace("return <input", "const save=()=>persist({draft});return <input"),
      0,
    );
  });

  it.each([
    "[entity.label]=['changed'];",
    "({slot:entity.label}=source);",
    "for(entity.label of values){}",
  ])("declines a record-field assignment target: %s", (statement) => {
    checkDraft(editableSource.replace("return <input", `${statement}return <input`), 1);
  });

  it.each(["render={customRender}", "readOnly", "disabled", "hidden"])(
    "declines an overridden control role: %s",
    (attribute) => {
      checkDraft(
        withControl(
          `<BaseInput value={draft} onChange={event=>setDraft(event.target.value)} ${attribute}/>`,
          "import {Input as BaseInput} from '@base-ui/react/input';\n",
        ),
        1,
      );
    },
  );

  it.each([
    "import R from 'react';R.valueOf().createElement=fake;",
    "import * as R from 'react';R.__defineGetter__('createElement',()=>fake);",
    "import {default as R} from 'react';R.valueOf().createElement=fake;",
  ])("declines a runtime React namespace alias: %s", (provider) => {
    checkDraft(provider + editableSource, 1);
  });

  it("keeps a React namespace used only for type annotations", () => {
    checkDraft(
      "import * as R from 'react';type Props=R.ComponentProps<'input'>;" + editableSource,
      0,
    );
  });

  it("declines a React namespace mutation inside an input wrapper", () => {
    writeFixture(
      "src/field-input.tsx",
      "import R from 'react';import {Input as BaseInput} from '@base-ui/react/input';R.valueOf().createElement=fake;export const FieldInput=({...props})=><BaseInput {...props}/>;",
    );
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {FieldInput} from './field-input';\n",
      ),
      1,
    );
  });

  it.each([
    "(()=>{}).constructor('return globalThis')();",
    "(()=>{})['constructor']('return globalThis')();",
    "const {constructor:makeCode}=(()=>{});makeCode('return globalThis')();",
  ])("declines a visible function constructor capability: %s", (statement) => {
    checkDraft(statement + editableSource, 1);
  });

  it("declines a hidden textarea", () => {
    checkDraft(
      withControl(
        "<textarea hidden value={draft} onChange={event=>setDraft(event.target.value)}/>",
      ),
      1,
    );
  });

  it.each([
    "import * as React from 'react';function FieldInput({className,...props}:React.ComponentProps<'textarea'>){return (<textarea className={className} {...props}/>)}export {FieldInput};",
    "import * as React from 'react';import {Input as BaseInput} from '@base-ui/react/input';function FieldInput({className,type,...props}:React.ComponentProps<'input'>){return (<BaseInput type={type} className={className} {...props}/>)}export {FieldInput};",
    "export const FieldInput=({...props})=>{return (<textarea {...props}/>)};",
  ])("accepts an imported wrapper returning parenthesized JSX: %s", (provider) => {
    writeFixture("src/field-input.tsx", provider);
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {FieldInput} from './field-input';\n",
      ),
      0,
    );
  });

  it("declines a parenthesized conditional wrapper return", () => {
    writeFixture(
      "src/field-input.tsx",
      "export const FieldInput=({...props})=>{return (condition ? <textarea {...props}/> : <textarea readOnly {...props}/>)};",
    );
    checkDraft(
      withControl(
        "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
        "import {FieldInput} from './field-input';\n",
      ),
      1,
    );
  });

  it("refreshes an imported record domain after the host reset with equal size and timestamp", () => {
    const provider = writeFixture(
      "src/domain/entity.ts",
      "export interface Entity {slug:string;label:string}",
    );
    const source = editableSource.replace(
      stringRecord,
      "import type {Entity} from './domain/entity';",
    );
    checkDraft(source, 0);
    const previous = fs.statSync(provider);
    fs.writeFileSync(provider, "export interface Entity {slug:number;label:string}");
    fs.utimesSync(provider, previous.atime, previous.mtime);
    expect(fs.statSync(provider).size).toBe(previous.size);
    resetFilesystemCaches();
    checkDraft(source, 1);
  });
  it.each([
    {
      name: "review-nominal-keyed-editor",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-seed-as-string",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label as string);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-seed-non-null",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label!);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-hook-callee-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=(useState as any)(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-hook-callee-non-null",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState!(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-hook-result-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=(useState(entity.label) as [string,any]);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-record-seed-receiver-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState((entity as Entity).label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-state-controlled-value-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft as string} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-controlled-callback-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={(event=>setDraft(event.target.value)) as any}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-controlled-setter-callee-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>(setDraft as any)(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-event-value-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value as string)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-event-target-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft((event.target as HTMLInputElement).value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-caller-key-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug as string} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-caller-prop-as",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity as Entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-hook-erased-name",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\ninterface useState {note:string}",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-editor-erased-name",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\ninterface EditForm {note:string}",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-nominal-base-ui",
      code: "import {Input} from '@base-ui/react/input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <Input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-base-ui-erased-name",
      code: "import {Input} from '@base-ui/react/input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <Input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\ninterface Input {note:string}",
      warningCount: 0,
      providers: {},
    },
    {
      name: "review-negative-missing-key",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "review-negative-hook-erased-name",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm entity={entity}/>;\ninterface useState {note:string}",
      warningCount: 1,
      providers: {},
    },
    {
      name: "review-negative-editor-erased-name",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm entity={entity}/>;\ninterface EditForm {note:string}",
      warningCount: 1,
      providers: {},
    },
    {
      name: "review-negative-base-ui-erased-name",
      code: "import {Input} from '@base-ui/react/input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <Input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm entity={entity}/>;\ninterface Input {note:string}",
      warningCount: 1,
      providers: {},
    },
    {
      name: "provider-nominal-imported-native-wrapper",
      code: "import {FieldInput} from './field-input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {
        "src/field-input.tsx": "export const FieldInput=({...props})=><input {...props}/>;",
      },
    },
    {
      name: "provider-provider-preact-pragma",
      code: "import {FieldInput} from './field-input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {
        "src/field-input.tsx":
          "/** @jsxImportSource preact */\nexport const FieldInput=({...props})=><input {...props}/>;",
      },
    },
    {
      name: "provider-provider-jsx-factory",
      code: "import {FieldInput} from './field-input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {
        "src/field-input.tsx":
          "/** @jsx customFactory */\nexport const FieldInput=({...props})=><input {...props}/>;",
      },
    },
    {
      name: "provider-provider-jsx-runtime",
      code: "import {FieldInput} from './field-input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {
        "src/field-input.tsx":
          "/** @jsxRuntime automatic */\nexport const FieldInput=({...props})=><input {...props}/>;",
      },
    },
    {
      name: "provider-provider-preact-import",
      code: "import {FieldInput} from './field-input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {
        "src/field-input.tsx":
          "import {h} from 'preact';\nexport const FieldInput=({...props})=><input {...props}/>;",
      },
    },
    {
      name: "provider-provider-preact-factory",
      code: "import {FieldInput} from './field-input';\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {
        "src/field-input.tsx":
          "/** @jsx h */\nimport {h} from 'preact';\nexport const FieldInput=({...props})=><input {...props}/>;",
      },
    },
    {
      name: "inert-nominal",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "inert-inert-object-keys",
      code: 'const notes = { Function: "description", React: "description", Reflect: "description", eval: "description", window: "description" };\nimport {useState} from \'react\';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;',
      warningCount: 0,
      providers: {},
    },
    {
      name: "inert-static-class-method-names",
      code: "class Notes { Function(){} React(){} Reflect(){} eval(){} }\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "inert-inert-interface-keys",
      code: "interface Notes { Function: string; React: string; Reflect: string; }\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 0,
      providers: {},
    },
    {
      name: "inert-runtime-shorthand-reference",
      code: "const notes = { Function };\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "inert-computed-runtime-reference",
      code: "const notes = { [Function]: \"description\" };\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "inert-unindexed-catch-default",
      code: "try { throw {}; } catch ({value = Function}) {}\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "ambient-function-competitor",
      code: "declare function EditForm(props: unknown): unknown;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "ambient-value-competitor",
      code: "declare const EditForm: unknown;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "runtime-namespace-competitor",
      code: "namespace EditForm { export const marker = 1; }\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
  ])("preserves the bounded draft proof: $name", ({ code, warningCount, providers }) => {
    for (const [relativePath, source] of Object.entries(providers))
      writeFixture(relativePath, source);
    const filename = writeFixture("src/component.tsx", code);
    const result = runRule(noDerivedUseState, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(warningCount);
  });
  it("refreshes a provider renderer proof after an equal-size timestamp-preserving edit", () => {
    const ordinaryPrefix = "/* ordinary renderer */";
    const opaquePrefix = "/** @jsx custom       */";
    const prefixLength = Math.max(ordinaryPrefix.length, opaquePrefix.length);
    const providerBody = "export const FieldInput=({...props})=><input {...props}/>;";
    const provider = writeFixture(
      "src/field-input.tsx",
      ordinaryPrefix.padEnd(prefixLength) + providerBody,
    );
    const source = withControl(
      "<FieldInput value={draft} onChange={event=>setDraft(event.target.value)}/>",
      "import {FieldInput} from './field-input';\n",
    );
    checkDraft(source, 0);
    const previous = fs.statSync(provider);
    fs.writeFileSync(provider, opaquePrefix.padEnd(prefixLength) + providerBody);
    fs.utimesSync(provider, previous.atime, previous.mtime);
    expect(fs.statSync(provider).size).toBe(previous.size);
    resetFilesystemCaches();
    checkDraft(source, 1);
  });
  it.each([
    {
      name: "wrapped-record-field-assignment",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{(entity as Entity).label = \"changed\";const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "wrapped-record-field-update",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{delete (entity as Entity).label;const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "optional-hook-call",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState?.(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
    {
      name: "optional-seed-receiver",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity?.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      warningCount: 1,
      providers: {},
    },
  ])("keeps unsupported value mutations opaque: $name", ({ code, warningCount }) => {
    const filename = writeFixture("src/component.tsx", code);
    const result = runRule(noDerivedUseState, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(warningCount);
  });
  it.each([
    {
      name: "inert-object-constructor-key",
      code: "const notes = { constructor: \"description\" };\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "actual-constructor-destructure",
      code: "const {constructor:makeCode}=(()=>{});makeCode(\"return 1\")();\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 1,
    },
    {
      name: "actual-constructor-member",
      code: "(()=>{}).constructor(\"return 1\")();\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 1,
    },
  ])("distinguishes constructor names from capabilities: $name", ({ code, expected }) => {
    const filename = writeFixture("src/component.tsx", code);
    const result = runRule(noDerivedUseState, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
  it.each([
    {
      name: "erased-nested-constructor-binding",
      code: "type Notes=({nested:{constructor}}:{nested:{constructor:string}})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-function-binding",
      code: "type Notes=({Function}:{Function:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "runtime-constructor-destructure",
      code: "const {constructor:makeCode}=(()=>{});makeCode(\"return 1\")();\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 1,
    },
  ])(
    "keeps erased declaration subtrees outside runtime provider proof: $name",
    ({ code, expected }) => {
      const filename = writeFixture("src/component.tsx", code);
      const result = runRule(noDerivedUseState, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
  it.each([
    {
      name: "erased-function-pattern-useState",
      code: "type Notes=({useState}:{useState:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-function-pattern-EditForm",
      code: "type Notes=({EditForm}:{EditForm:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-function-pattern-entity",
      code: "type Notes=({entity}:{entity:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-function-pattern-draft",
      code: "type Notes=({draft}:{draft:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-function-pattern-setDraft",
      code: "type Notes=({setDraft}:{setDraft:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-function-pattern-Input",
      code: "type Notes=({Input}:{Input:string})=>void;\nimport {useState} from 'react'; import {Input} from '@base-ui/react/input';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <Input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "nominal-Input",
      code: "import {useState} from 'react'; import {Input} from '@base-ui/react/input';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <Input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
  ])(
    "ignores wholly erased binding patterns when closing runtime references: $name",
    ({ code, expected }) => {
      const filename = writeFixture("src/component.tsx", code);
      const result = runRule(noDerivedUseState, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
  it.each([
    {
      name: "erased-type-only-component-export",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nexport type {EditForm};",
      expected: 0,
    },
    {
      name: "erased-type-only-hook-export",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nexport type {useState};",
      expected: 0,
    },
    {
      name: "runtime-component-export",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nexport {EditForm};",
      expected: 1,
    },
    {
      name: "erased-annotation-constructor-pattern",
      code: "declare const notes: ({nested:{constructor}}:{nested:{constructor:string}})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "erased-annotation-hook-pattern",
      code: "declare const notes: ({useState}:{useState:string})=>void;\nimport {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;",
      expected: 0,
    },
    {
      name: "inline-type-only-component-export",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nexport {type EditForm};",
      expected: 0,
    },
    {
      name: "inline-type-only-hook-export",
      code: "import {useState} from 'react';\ninterface Entity {slug:string;label:string}\nconst EditForm=({entity}:{entity:Entity})=>{const [draft,setDraft]=useState(entity.label);return <input value={draft} onChange={event=>setDraft(event.target.value)}/>};\nexport const Screen=({entity}:{entity:Entity})=><EditForm key={entity.slug} entity={entity}/>;\nexport {type useState};",
      expected: 0,
    },
  ])(
    "keeps erased references closed without accepting runtime exports: $name",
    ({ code, expected }) => {
      const filename = writeFixture("src/component.tsx", code);
      const result = runRule(noDerivedUseState, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );
});
