import type { RuleContract } from "./classification-schema.js";

export interface PinnedRuleContract {
  path: string;
  sha256: string;
  contract: Partial<RuleContract>;
}

export const pinnedRuleContracts: Readonly<Record<string, PinnedRuleContract>> = {
  "react-doctor/react-in-jsx-scope": {
    path: "packages/oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/react-in-jsx-scope.ts",
    sha256: "01413a540d79e3e34c16a1c86e4872c3b3765010f0025ab14720b7d48eb41ade",
    contract: {
      requiredEvidence: ["verified-contract", "jsx-runtime"],
      exceptions: [
        "Applies only to the classic JSX transform requiring a React binding visible from the JSX site's lexical scope.",
        "An automatic JSX transform does not need React in scope. React version alone does not establish the transform.",
        "A React binding in a sibling scope does not satisfy the requirement.",
      ],
    },
  },
  "react-doctor/jsx-props-no-spreading": {
    path: "packages/oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/jsx-props-no-spreading.ts",
    sha256: "5f952bc10e4755ad1c4f1bf1187a17f9bc5a8a8c701e4e1353c4650b264151af",
    contract: {
      requiredEvidence: ["verified-contract"],
      settings: {
        namespace: "react-doctor.jsxPropsNoSpreading",
        effective: {
          html: "enforce",
          custom: "enforce",
          explicitSpread: "enforce",
          exceptions: [],
        },
        evidence:
          "The isolated evaluation config supplies no rule settings; these are canonical defaults, not repository preferences.",
      },
      exceptions: [
        "This is an optional style policy. Prop forwarding is not by itself a semantic correctness defect.",
        "html/custom accept enforce or ignore. A tag in exceptions flips that tag class's mode.",
        "explicitSpread: ignore permits object literals only when they contain no nested spread; the default is enforce.",
        "Custom tags start with a component name or contain a dot. Member-expression names are matched in full.",
        "A closed ordinary React CSF2 template is exempt when its sole readonly parameter is forwarded as the sole spread to the exact imported metadata component, every template use is a direct .bind({}) exported story, and each story has one ordinary args assignment.",
        "This finite certificate assumes ordinary React, module, and native-bind integrity. Incompatible runtime profiles, custom JSX pragmas, provider mutation, and unsupported value transport decline the exemption; type names, filenames, CSF3 render functions, and direct stories alone are insufficient.",
      ],
    },
  },
};
