import { describe, expect, it } from "vite-plus/test";
import { reactDoctorRules } from "../rule-registry.js";

const EXPECTED_REACT_ROUTER_RULE_GATES = {
  "react-router-csp-nonce-consistency": ["react-router:7", "react-router-framework"],
  "react-router-descendant-routes-require-splat": ["react-router"],
  "react-router-guard-aborted-handle-error": ["react-router:7", "react-router-framework"],
  "react-router-internal-route-anchor": ["react-router:6.4"],
  "react-router-loader-fetch-forwards-signal": ["react", "react-router:6.4"],
  "react-router-loader-parallel-fetch": ["react", "react-router:6.4"],
  "react-router-nested-route-requires-outlet": ["react-router"],
  "react-router-no-catch-middleware-next": ["react-router:7.8", "react-router-framework"],
  "react-router-no-client-module-in-server-render": ["react-router:7", "react-router-framework"],
  "react-router-no-duplicate-route-id": ["react-router:6.4"],
  "react-router-no-empty-leaf-route": ["react-router:6.4"],
  "react-router-no-invalid-absolute-child-path": ["react-router"],
  "react-router-no-invalid-lazy-route-properties": ["react-router:6.9"],
  "react-router-no-invalid-splat-path": ["react-router"],
  "react-router-no-loader-request-body": ["react-router:6.4"],
  "react-router-no-middleware-response-body-consumption": [
    "react-router:7.9",
    "react-router-framework",
  ],
  "react-router-no-multiple-blockers": ["react-router:6.7"],
  "react-router-no-multiple-middleware-next": ["react-router:7.9", "react-router-framework"],
  "react-router-no-multiple-set-search-params-in-tick": ["react-router"],
  "react-router-no-navigate-in-render": ["react-router"],
  "react-router-no-nested-router": ["react-router"],
  "react-router-no-redirect-in-try-catch": ["react-router:6.4"],
  "react-router-no-route-module-environment-suffix": ["react-router:7", "react-router-framework"],
  "react-router-no-router-in-render": ["react-router:6.4"],
  "react-router-no-session-mutation-in-loader": ["react-router:7", "react-router-framework"],
  "react-router-no-static-cookie-expires": ["react-router:7", "react-router-framework"],
  "react-router-no-unsynchronized-search-params-mutation": ["react-router"],
  "react-router-no-use-loader-data-in-error-ui": ["react-router:6.4"],
  "react-router-prefer-route-lazy": ["react", "react-router:6.9"],
  "react-router-require-root-error-boundary": ["react-router:6.4"],
  "react-router-resource-link-requires-reload": ["react-router:6.4"],
  "react-router-return-navigation-promise-in-transition": ["react-router:7.10"],
  "react-router-server-middleware-return-response": ["react-router:7.9", "react-router-framework"],
  "react-router-session-mutation-requires-commit": ["react-router:7", "react-router-framework"],
  "react-router-v8-no-meta-data-field": ["react-router:8"],
  "react-router-v8-no-react-router-dom-import": ["react-router:8"],
  "react-router-v8-no-removed-future-flags": ["react-router:8", "react-router-framework"],
  "react-router-valid-route-object": ["react-router:6.4"],
};

describe("React Router rule version gates", () => {
  it("keeps every React Router rule on its researched capability boundary", () => {
    const actualGates = Object.fromEntries(
      reactDoctorRules
        .filter((registryEntry) => registryEntry.id.startsWith("react-router-"))
        .map((registryEntry) => [registryEntry.id, registryEntry.rule.requires]),
    );

    expect(actualGates).toEqual(EXPECTED_REACT_ROUTER_RULE_GATES);
  });

  it("keeps route lazy disabled for Framework projects", () => {
    const routeLazyRule = reactDoctorRules.find(
      (registryEntry) => registryEntry.id === "react-router-prefer-route-lazy",
    );

    expect(routeLazyRule?.rule.disabledWhen).toEqual(["react-router-framework"]);
  });
});
