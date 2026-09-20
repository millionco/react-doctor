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
    sha256: "43ee949e10d93b8ba8ad3bc78ddb6eaa24e9f989fca9429a5335d9591a42cef2",
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
      ],
    },
  },
};
