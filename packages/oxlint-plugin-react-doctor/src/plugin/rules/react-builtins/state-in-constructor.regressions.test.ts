import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { stateInConstructor } from "./state-in-constructor.js";

const cases = [
  {
    name: "typed literal declaration with constructor",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\nstate: { ready: boolean };\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-00.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "public typed reference with constructor",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\npublic state: FieldState;\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-01.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "definite assignment typed declaration",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\nstate!: FieldState;\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-02.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "declare typed declaration",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\ndeclare state: FieldState;\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-03.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "uninitialized JavaScript field policy boundary",
    code: 'import * as React from "react";\nclass Panel extends React.Component { state; constructor(props) { super(props); this.state = {}; } }\n',
    expectedCount: 1,
    options: {
      filename: "public-state-style-04.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "explicit undefined null false zero initializers retained",
    code: 'import * as React from "react";\nclass Empty extends React.Component { state = undefined; }\nclass Nullish extends React.Component { state = null; }\nclass Disabled extends React.Component { state = false; }\nclass Zero extends React.Component { state = 0; }\n',
    expectedCount: 4,
    options: {
      filename: "public-state-style-05.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "typed initialized state retained",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\nstate: FieldState = { ready: false };\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 1,
    options: {
      filename: "public-state-style-06.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "static typed and initialized state excluded",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Typed extends React.Component { static state: FieldState; }\nclass Initialized extends React.Component { static state = {}; }\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-07.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "different property key excluded",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\nstatus: FieldState;\nother = {};\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-08.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "non React class excluded",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Plain { state: FieldState; }\nclass Other { state = {}; }\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-09.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "never mode constructor assignment retained",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Panel extends React.Component {\npublic state: FieldState;\nconstructor(props) { super(props); this.state = { ready: false }; }\n}\n',
    expectedCount: 1,
    options: {
      filename: "public-state-style-10.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
          stateInConstructor: {
            mode: "never",
          },
        },
      },
    },
  },
  {
    name: "visibility typed declarations",
    code: 'import * as React from "react";\ninterface FieldState { ready: boolean }\nclass Public extends React.Component { public state: FieldState; constructor(props) { super(props); this.state = { ready: false }; } }\nclass Protected extends React.Component { protected state: FieldState; constructor(props) { super(props); this.state = { ready: false }; } }\nclass Private extends React.Component { private state: FieldState; constructor(props) { super(props); this.state = { ready: false }; } }\n',
    expectedCount: 0,
    options: {
      filename: "public-state-style-11.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "optional typed declaration",
    code: 'import * as React from "react";\ninterface StateShape { ready: boolean }\nclass Panel extends React.Component { state?: StateShape; constructor(props) { super(props); this.state = { ready: false }; } }\n',
    expectedCount: 0,
    options: {
      filename: "independent-state-style-extra.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "readonly typed declaration",
    code: 'import * as React from "react";\ninterface StateShape { ready: boolean }\nclass Panel extends React.Component { readonly state: StateShape; constructor(props) { super(props); this.state = { ready: false }; } }\n',
    expectedCount: 0,
    options: {
      filename: "independent-state-style-extra.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "static string state key typed declaration",
    code: 'import * as React from "react";\ninterface StateShape { ready: boolean }\nclass Panel extends React.Component { "state": StateShape; constructor(props) { super(props); this.state = { ready: false }; } }\n',
    expectedCount: 0,
    options: {
      filename: "independent-state-style-extra.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "typed explicit undefined null false zero retained",
    code: 'import * as React from "react";\ninterface StateShape { ready: boolean }\nclass Empty extends React.Component { state: undefined = undefined; }\nclass Nullish extends React.Component { state: null = null; }\nclass Disabled extends React.Component { state: false = false; }\nclass Zero extends React.Component { state: 0 = 0; }\n',
    expectedCount: 4,
    options: {
      filename: "independent-state-style-extra.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "mixed typed declaration and initialized field",
    code: 'import * as React from "react";\ninterface StateShape { ready: boolean }\nclass First extends React.Component { state: StateShape; constructor(props) { super(props); this.state = { ready: false }; } }\nclass Second extends React.Component { state = { ready: false }; }\n',
    expectedCount: 1,
    options: {
      filename: "independent-state-style-extra.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
        },
      },
    },
  },
  {
    name: "never typed declaration without constructor assignment",
    code: 'import * as React from "react";\ninterface StateShape { ready: boolean }\nclass Panel extends React.Component { state: StateShape; }\n',
    expectedCount: 0,
    options: {
      filename: "independent-state-style-extra.tsx",
      forceJsx: true,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "react:16"],
          stateInConstructor: {
            mode: "never",
          },
        },
      },
    },
  },
];

describe("state-in-constructor typed declarations", () => {
  it.each(cases)("$name", ({ code, expectedCount, options }) => {
    const result = runRule(stateInConstructor, code, options);
    expect(result.parseErrors).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
