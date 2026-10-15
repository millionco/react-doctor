import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

describe("state payload consumed by an independent effect", () => {
  it.each([
    {
      name: "guard-only-self-echo",
      source:
        'import {useEffect,useState} from "react";\nexport const SignalPanel=({flush})=>{const[pending,setPending]=useState(false);\nuseEffect(()=>{if(pending){flush();setPending(false);}},[pending,flush]);\nreturn <button onClick={()=>setPending(true)}>Send</button>;};\n',
      expected: 1,
    },
    {
      name: "independent-call-payload",
      source:
        'import {useEffect,useState} from "react";\nexport const ResourceBridge=({createRecord,acceptRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(activeRecord!==null){acceptRecord(activeRecord);setActiveRecord(null);}},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "independent-member-payload",
      source:
        'import {useEffect,useState} from "react";\nexport const AttachmentBridge=({createRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(activeRecord!==null)activeRecord.refresh();},[activeRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "shadowed-payload-does-not-rescue",
      source:
        'import {useEffect,useState} from "react";\nexport const LocalSignal=({createRecord,acceptRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(activeRecord!==null){{const activeRecord="local";acceptRecord(activeRecord);}setActiveRecord(null);}},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "only two self-echo effects",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(activeRecord)setActiveRecord(null);},[activeRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "payload argument only in a guard",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(acceptRecord(activeRecord))setActiveRecord(null);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "member receiver only in a guard",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(activeRecord.ready)setActiveRecord(null);},[activeRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "uncalled nested payload",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{const consume=()=>acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "timer payload remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{setTimeout(()=>acceptRecord(activeRecord),0);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "cleanup payload remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "nested component effect remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nconst Unused=()=>{useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);return null;};\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "literal dead payload",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(false)acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "payload after return",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{return;acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "unreachable effect registration",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nreturn <section/>;useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\n};\n',
      expected: 1,
    },
    {
      name: "referenced callback remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nconst consume=()=>acceptRecord(activeRecord);useEffect(consume,[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "payload without a matching dependency",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "readonly scalar alias remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nconst payload=activeRecord;useEffect(()=>acceptRecord(payload),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "mutable value binding remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{let[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "replaced value binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nactiveRecord=replacement;\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "pattern-replaced value binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\n[activeRecord]=replacement;\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "loop-replaced value binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nfor(activeRecord of replacement){}\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "replaced setter binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nsetActiveRecord=replacement;\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "pattern-replaced setter binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\n({write:setActiveRecord}=replacement);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "harmless setter metadata",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nsetActiveRecord.description="local";\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "computed key read preserves binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nlet discarded;({[activeRecord]:discarded}=replacement);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "default right-hand read preserves binding",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nlet discarded;({value:discarded=activeRecord}=replacement);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "layout effect payload",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseLayoutEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "function-expression effect payload",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(function(){acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "async effect remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(async()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "nested immediate callback remains unsupported",
      source:
        'import {useEffect,useLayoutEffect,useState} from "react";\nexport const RecordPanel=({createRecord,acceptRecord,replacement})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{(()=>acceptRecord(activeRecord))();},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "generator callback remains unsupported",
      source:
        'import {useEffect,useState} from "react";\nexport const InputPanel=({createRecord,acceptRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(function*(){acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "parameter-dependent callback remains unsupported",
      source:
        'import {useEffect,useState} from "react";\nexport const InputPanel=({createRecord,acceptRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect((enabled=false)=>{if(enabled)acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "own this-dependent callback remains unsupported",
      source:
        'import {useEffect,useState} from "react";\nexport const InputPanel=({createRecord,acceptRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(function(){if(this)acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "own arguments-dependent callback remains unsupported",
      source:
        'import {useEffect,useState} from "react";\nexport const InputPanel=({createRecord,acceptRecord})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(function(){if(arguments.length)acceptRecord(activeRecord);},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero if payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(0){acceptRecord(activeRecord);}},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero conditional payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{0?acceptRecord(activeRecord):undefined;},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero if registration",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nif(0){useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);}\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero conditional registration",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\n0?useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]):undefined;\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate empty string if payload",
      source:
        "import {useEffect,useState} from \"react\";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(''){acceptRecord(activeRecord);}},[activeRecord,acceptRecord]);\nreturn <section/>;};\n",
      expected: 1,
    },
    {
      name: "primitive predicate empty string conditional payload",
      source:
        "import {useEffect,useState} from \"react\";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{''?acceptRecord(activeRecord):undefined;},[activeRecord,acceptRecord]);\nreturn <section/>;};\n",
      expected: 1,
    },
    {
      name: "primitive predicate empty string if registration",
      source:
        "import {useEffect,useState} from \"react\";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nif(''){useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);}\nreturn <section/>;};\n",
      expected: 1,
    },
    {
      name: "primitive predicate empty string conditional registration",
      source:
        "import {useEffect,useState} from \"react\";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\n''?useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]):undefined;\nreturn <section/>;};\n",
      expected: 1,
    },
    {
      name: "primitive predicate null if payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(null){acceptRecord(activeRecord);}},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate null conditional payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{null?acceptRecord(activeRecord):undefined;},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate null if registration",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nif(null){useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);}\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate null conditional registration",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nnull?useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]):undefined;\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero bigint if payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(0n){acceptRecord(activeRecord);}},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero bigint conditional payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{0n?acceptRecord(activeRecord):undefined;},[activeRecord,acceptRecord]);\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero bigint if registration",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nif(0n){useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]);}\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate zero bigint conditional registration",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\n0n?useEffect(()=>acceptRecord(activeRecord),[activeRecord,acceptRecord]):undefined;\nreturn <section/>;};\n',
      expected: 1,
    },
    {
      name: "primitive predicate truthy if payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(1){acceptRecord(activeRecord);}},[activeRecord,acceptRecord,enabled]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "primitive predicate truthy conditional payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{1?acceptRecord(activeRecord):undefined;},[activeRecord,acceptRecord,enabled]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "primitive predicate unknown if payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{if(enabled){acceptRecord(activeRecord);}},[activeRecord,acceptRecord,enabled]);\nreturn <section/>;};\n',
      expected: 0,
    },
    {
      name: "primitive predicate unknown conditional payload",
      source:
        'import {useEffect,useState} from "react";\nexport const PrimitivePanel=({createRecord,acceptRecord,enabled})=>{const[activeRecord,setActiveRecord]=useState(null);\nuseEffect(()=>{if(activeRecord===null)setActiveRecord(createRecord());},[activeRecord,createRecord]);\nuseEffect(()=>{enabled?acceptRecord(activeRecord):undefined;},[activeRecord,acceptRecord,enabled]);\nreturn <section/>;};\n',
      expected: 0,
    },
  ])("$name", ({ source, expected }) => {
    const result = runRule(rerenderStateOnlyInHandlers, source, { filename: "src/payload.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
