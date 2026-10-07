import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const clientLocalstorageNoVersion = defineRetiredRule({
  id: "client-localstorage-no-version",
  severity: "warn",
  category: "Bugs",
  requires: ["react"],
  tags: ["test-noise"],
  title: "Unversioned localStorage key",
  recommendation:
    "Retired: Storage can keep its version in the payload or use a separate migration path.",
});
