import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { reactRouterNoNavigateInRender } from "./react-router-no-navigate-in-render.js";

interface NativeSubmitNavigationCase {
  readonly name: string;
  readonly code: string;
  readonly options: RunRuleOptions;
  readonly expectedCount: number;
}

const cases: ReadonlyArray<NativeSubmitNavigationCase> = [
  {
    name: "uppercase-async-helper-native-submit",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-00.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "synchronous-uppercase-helper-native-submit",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-01.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "conditional-native-form-under-react-fragment",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <Fragment><p>Entry</p>{true ? <form onSubmit={onSubmit}><button>Go</button></form> : <span>Idle</span>}</Fragment>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-02.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "mixed-direct-render-helper-invocation",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  CREATE_SESSION(); return <form onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-03.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "uppercase-helper-used-as-jsx-component",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <Fragment><CREATE_SESSION /><form onSubmit={onSubmit} /></Fragment>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-04.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "helper-transport-to-opaque-callback",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst inspect = (callback: unknown) => { void callback; };\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  inspect(CREATE_SESSION); return <form onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-05.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "helper-property-transport",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  const registry = { run: CREATE_SESSION }; void registry; return <form onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-06.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "submit-handler-invoked-during-render",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  onSubmit({ preventDefault: () => {} }); return <form onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-07.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "custom-component-on-submit-prop",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst CustomForm = ({ onSubmit }: { onSubmit: unknown }) => { void onSubmit; return null; };\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <CustomForm onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-08.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "handler-call-inside-jsx-attribute",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit({ preventDefault: () => {} })} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-09.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "later-spread-may-override-native-handler",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = ({ attributes }: { attributes: Record<string, unknown> }) => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit} {...attributes} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-10.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "duplicate-submit-attribute-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit} onSubmit={() => {}} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-11.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "opaque-transport-of-native-form-value",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst inspect = (value: unknown) => { void value; return null; };\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return inspect(<form onSubmit={onSubmit} />);\n};\n',
    options: {
      filename: "src/native-submit-helper/case-12.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "customized-native-form-is-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form is="custom-form" onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-13.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "recursive-helper-chain-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { if (false) CREATE_SESSION(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-14.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "rebound-helper-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  let CREATE_SESSION = () => { navigate("/next"); }; CREATE_SESSION = () => { navigate("/other"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-15.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "shadowed-handler-anchor-does-not-cover-real-caller",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  const renderForm = () => { const onSubmit = () => {}; return <form onSubmit={onSubmit} />; }; return renderForm();\n};\n',
    options: {
      filename: "src/native-submit-helper/case-16.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "readonly-handler-alias-transport-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  const exportedHandler = onSubmit; void exportedHandler; return <form onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-17.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "opaque-handler-initializer-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst wrap = (callback: (event: { preventDefault: () => void }) => void) => callback;\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = wrap((event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); });\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-18.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "runtime-erased-binding-preserves-closed-helper",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { interface CREATE_SESSION {} event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-19.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 0,
  },
  {
    name: "runtime-typescript-namespace-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nnamespace RuntimeProfile { export const value = 1; }\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-20.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "default-handler-parameter-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event = { preventDefault: () => {} }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-21.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "mixed-helper-call-through-another-function",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  const renderRunner = () => { CREATE_SESSION(); }; renderRunner(); return <form onSubmit={onSubmit} />;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-22.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "visible-react-provider-write-declined",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nimport * as ReactProvider from "react";\nReactProvider.createElement = (() => null);\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = async () => { await Promise.resolve(); navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-23.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "opaque-native-form-ancestor-eagerly-calls-submit",
    code: 'import type { ReactElement } from "react";\nimport { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nconst EagerWrapper = ({ children }: { children: ReactElement<{ onSubmit: (event: { preventDefault: () => void }) => void }> }) => { children.props.onSubmit({ preventDefault: () => {} }); return children; };\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <EagerWrapper><form onSubmit={onSubmit}><button type="submit">Go</button></form></EagerWrapper>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-24.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "local-fragment-name-eagerly-calls-submit",
    code: 'import type { ReactElement } from "react";\nimport { useNavigate } from "react-router-dom";\nconst Fragment = ({ children }: { children: ReactElement<{ onSubmit: (event: { preventDefault: () => void }) => void }> }) => { children.props.onSubmit({ preventDefault: () => {} }); return children; };\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <Fragment><form onSubmit={onSubmit}><button type="submit">Go</button></form></Fragment>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-25.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "unused-native-form-container-abstention",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  const unused = <form onSubmit={onSubmit}><button type="submit">Go</button></form>; void unused; return null;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-26.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "type-only-router-hook-does-not-certify",
    code: 'import { Fragment } from "react";\nimport type { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-27.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "inline-type-only-router-hook-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { type useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-28.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "optional-navigation-call-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate?.("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-29.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "optional-helper-call-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION?.(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-30.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "constructed-helper-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); new CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-31.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "custom-jsx-factory-does-not-certify",
    code: '/** @jsx eagerElement */\nimport { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-32.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "router-namespace-provider-write-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nimport * as RouterProvider from "react-router-dom";\nRouterProvider.useNavigate = () => () => {};\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-33.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "direct-eval-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { eval("CREATE_SESSION()"); event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-34.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "ambient-eval-binding-does-not-certify",
    code: 'declare const eval: (source:string) => unknown;\nimport { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { eval("CREATE_SESSION()"); event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-35.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "named-helper-expression-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = function CREATE_SESSION() { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-36.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "direct-component-value-transport-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\nconst rendered = Screen(); rendered.props.onSubmit({preventDefault(){}});\n',
    options: {
      filename: "src/native-submit-helper/case-37.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "navigation-function-transport-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  inspectNavigation(navigate);\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-38.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "two-handler-parameters-do-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }, extra:unknown) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-39.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "customized-native-ancestor-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = () => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <div is="custom-shell"><form onSubmit={onSubmit}><button type="submit">Go</button></form></div>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-40.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
  {
    name: "helper-default-parameter-does-not-certify",
    code: 'import { Fragment } from "react";\nimport { useNavigate } from "react-router-dom";\nexport const Screen = () => {\n  const navigate = useNavigate();\n  const CREATE_SESSION = (value = 1) => { navigate("/next"); };\n  const onSubmit = (event: { preventDefault: () => void }) => { event.preventDefault(); CREATE_SESSION(); };\n  return <form onSubmit={onSubmit}><button type="submit">Go</button></form>;\n};\n',
    options: {
      filename: "src/native-submit-helper/case-41.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react-router"],
        },
      },
    },
    expectedCount: 1,
  },
];

describe("closed native submit navigation", () => {
  it.each(cases)("$name", ({ code, options, expectedCount }) => {
    const result = runRule(reactRouterNoNavigateInRender, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
