import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxPropsNoSpreading } from "./jsx-props-no-spreading.js";

const cases = [
  {
    name: "bound-template-concise",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/bound-template-concise.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 0,
    expectedLocation: null,
  },
  {
    name: "bound-template-single-return-block",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => { return <ActionCard {...inputs} />; };\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/bound-template-single-return-block.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 0,
    expectedLocation: null,
  },
  {
    name: "renamed-values-ordinary-filename",
    code: 'import React from "react";\nimport { MessageTile } from "./action-card";\nconst details = { component: MessageTile };\nexport default details;\nconst Present = (values) => <MessageTile {...values} />;\nexport const Neutral = Present.bind({});\nNeutral.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/ordinary/preview.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 0,
    expectedLocation: null,
  },
  {
    name: "direct-default-object-metadata",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nexport default { component: ActionCard };\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/direct-default-object-metadata.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 0,
    expectedLocation: null,
  },
  {
    name: "ordinary-business-data-spread",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nexport const AccountSummary = ({ account }) => <ActionCard {...account} />;\n',
    options: {
      filename: "/synthetic/csf-forwarding/ordinary-business-data-spread.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "different-metadata-component",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nimport { OtherCard } from "./other-card";\nconst metadata = { component: OtherCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/different-metadata-component.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "types-and-filename-alone",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\ninterface MetaShape { component: unknown }\ninterface StoryShape { (inputs: unknown): unknown }\nconst RenderExample: StoryShape = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/types-and-filename-alone.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "reassigned-template-binding",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nlet RenderExample = (inputs) => <ActionCard {...inputs} />;\nRenderExample = otherTemplate;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/reassigned-template-binding.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "input-property-write",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => { inputs.label = "Changed"; return <ActionCard {...inputs} />; };\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/input-property-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "opaque-input-escape",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => { inspect(inputs); return <ActionCard {...inputs} />; };\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/opaque-input-escape.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "extra-overriding-jsx-attribute",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} label="Override" />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/extra-overriding-jsx-attribute.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "extra-default-parameter-evaluation",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs, extra = inspect()) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/extra-default-parameter-evaluation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "bound-leading-argument",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({}, { label: "Injected" });\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/bound-leading-argument.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "template-bind-method-replacement",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nRenderExample.bind = replacement;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/template-bind-method-replacement.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "bound-story-opaque-escape",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\ninspect(Basic);\n',
    options: {
      filename: "/synthetic/csf-forwarding/bound-story-opaque-escape.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "duplicate-metadata-component",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard, component: OtherCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/duplicate-metadata-component.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "metadata-value-alias-write",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst changed = metadata;\nchanged.component = OtherCard;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/metadata-value-alias-write.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "namespace-component-expression",
    code: 'import React from "react";\nimport * as Widgets from "./action-card";\nconst metadata = { component: Widgets.ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <Widgets.ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/namespace-component-expression.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "type-only-component-import",
    code: 'import React from "react";\nimport type { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/type-only-component-import.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "safe-template-followed-by-business-spread",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nexport const Dashboard = ({ record }) => <ActionCard {...record} />;\n',
    options: {
      filename: "/synthetic/csf-forwarding/safe-template-followed-by-business-spread.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: { line: 8, column: 53 },
  },
  {
    name: "template-direct-call-transport",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nexport const invoke = (record) => RenderExample(record);\n',
    options: {
      filename: "/synthetic/csf-forwarding/template-direct-call-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "nested-shadow-parameter-forwarding",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => { const nested = (inputs) => <ActionCard {...inputs} />; return nested(inputs); };\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/nested-shadow-parameter-forwarding.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "visible-native-bind-override",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nFunction.prototype.bind = replacement;\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/visible-native-bind-override.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "custom-jsx-pragma",
    code: '/** @jsx customFactory */\nimport React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/custom-jsx-pragma.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "alternate-react-provider-mutation",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nimport * as AlternateReact from "react";\nAlternateReact.createElement = replacement;\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/alternate-react-provider-mutation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "selected-module-namespace-provider-mutation",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nimport * as AlternateComponent from "./action-card";\nAlternateComponent.ActionCard = replacement;\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/selected-module-namespace-provider-mutation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "unknown-computed-callable-alias",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nconst methodName = chooseName();\nconst selectedMethod = providers[methodName];\nselectedMethod();\n',
    options: {
      filename: "/synthetic/csf-forwarding/unknown-computed-callable-alias.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "readonly-unrelated-computed-data-void",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nconst displayLabel = labels[selectedKey];\nvoid displayLabel;\n',
    options: {
      filename: "/synthetic/csf-forwarding/readonly-unrelated-computed-data-void.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 0,
    expectedLocation: null,
  },
  {
    name: "optional-template-bind-call",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind?.({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/optional-template-bind-call.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "story-args-getter-declines",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { get label() { return "Preview"; } };\n',
    options: {
      filename: "/synthetic/csf-forwarding/story-args-getter-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "story-args-second-assignment-declines",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nBasic.args = { label: "Changed" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/story-args-second-assignment-declines.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "nested-erased-component-transport",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\nconst exposeComponent = () => { interface ActionCard {} inspect(ActionCard); };\nexposeComponent();\n',
    options: {
      filename: "/synthetic/csf-forwarding/nested-erased-component-transport.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "jsx-runtime-namespace-mutation",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nimport * as JsxRuntime from "react/jsx-runtime";\nJsxRuntime.jsx = replacement;\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/jsx-runtime-namespace-mutation.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "explicit-preact-runtime-profile-policy-control",
    code: 'import React from "react";\nimport { h } from "preact";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/explicit-preact-runtime-profile-policy-control.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["preact", "pure-preact"],
          reactVersion: null,
          reactMajorVersion: null,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
          preactVersion: "10.26.0",
          preactMajorVersion: 10,
          framework: "preact",
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "mixed-react-preact-capabilities",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/mixed-react-preact-capabilities.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
          capabilities: ["react", "preact"],
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "preact-framework-with-react-capability",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/preact-framework-with-react-capability.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
          capabilities: ["react"],
          framework: "preact",
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "explicit-nonreact-capability",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/explicit-nonreact-capability.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
          capabilities: ["nextjs"],
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "unspecified-capability-retains-react-assumption",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/unspecified-capability-retains-react-assumption.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 0,
    expectedLocation: null,
  },
  {
    name: "explicit-empty-capabilities-decline",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename: "/synthetic/csf-forwarding/explicit-empty-capabilities-decline.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
          capabilities: [],
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
  {
    name: "explicit-pure-preact-conflicts-with-react-capability",
    code: 'import React from "react";\nimport { ActionCard } from "./action-card";\nconst metadata = { component: ActionCard };\nexport default metadata;\nconst RenderExample = (inputs) => <ActionCard {...inputs} />;\nexport const Basic = RenderExample.bind({});\nBasic.args = { label: "Preview" };\n',
    options: {
      filename:
        "/synthetic/csf-forwarding/explicit-pure-preact-conflicts-with-react-capability.tsx",
      forceJsx: false,
      includeLocations: true,
      settings: {
        "react-doctor": {
          portedRuleMode: "curated",
          capabilities: ["react", "pure-preact"],
          reactVersion: "18.3.1",
          reactMajorVersion: 18,
          jsxPropsNoSpreading: {
            html: "enforce",
            custom: "enforce",
            explicitSpread: "enforce",
            exceptions: [],
          },
        },
      },
    },
    expectedCount: 1,
    expectedLocation: null,
  },
];

describe("closed CSF2 bound template forwarding", () => {
  it.each(cases)("$name", ({ code, options, expectedCount, expectedLocation }) => {
    const result = runRule(jsxPropsNoSpreading, code, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
    if (expectedLocation) {
      expect(result.diagnostics.map(({ line, column }) => ({ line, column }))).toEqual([
        expectedLocation,
      ]);
    }
  });
});
