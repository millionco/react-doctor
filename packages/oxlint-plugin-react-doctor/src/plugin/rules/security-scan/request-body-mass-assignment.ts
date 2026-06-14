import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

// Server request input (Express `req.body`, framework `request.body`, route
// `params`/`query`, and `await request.json()`). Kept to unambiguous request
// sources so a bare `{ ...input }` of internal data does not false-match.
const REQUEST_INPUT_SOURCE =
  "(?:req|request|ctx\\.req|ctx\\.request)\\.(?:body|query|params)|await\\s+(?:req|request)\\.json\\(\\s*\\)";

// Spread of request input (`{ ...req.body }`, `{ id, ...req.body }`) — mass
// assignment: the client controls every column, so it can set `ownerId`,
// `role`, `isAdmin`, `price`, … on whatever object/DB row this flows into. The
// spread is matched wherever it sits, not only as the first property.
const SPREAD_REQUEST_INPUT_PATTERN = new RegExp(`\\.\\.\\.\\s*(?:${REQUEST_INPUT_SOURCE})`, "i");

// `Object.assign(target, req.body)` / lodash `merge` / `defaultsDeep` of
// request input — mass assignment plus prototype pollution (a `__proto__` /
// `constructor` key in the payload poisons Object.prototype).
const MERGE_REQUEST_INPUT_PATTERN = new RegExp(
  `(?:Object\\.assign\\s*\\(|_\\.(?:merge|mergeWith|defaultsDeep)\\s*\\(|(?:^|[^.\\w])(?:merge|defaultsDeep)\\s*\\()[\\s\\S]{0,80}?(?:${REQUEST_INPUT_SOURCE})`,
  "i",
);

export const requestBodyMassAssignment = defineRule({
  id: "request-body-mass-assignment",
  title: "Request input spread without field allowlist",
  severity: "warn",
  recommendation:
    "Assign explicit, allowlisted fields (or validate with a strict schema and no `.passthrough()`) instead of spreading/merging request input. Otherwise the client can set ownership, role, or price columns (mass assignment) or pollute the prototype.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern: [SPREAD_REQUEST_INPUT_PATTERN, MERGE_REQUEST_INPUT_PATTERN],
    message:
      "Request input is spread or merged into an object without a field allowlist, enabling mass assignment (client-set owner/role/price fields) or prototype pollution.",
  }),
});
