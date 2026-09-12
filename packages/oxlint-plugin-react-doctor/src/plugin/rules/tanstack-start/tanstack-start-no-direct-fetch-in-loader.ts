import { defineRetiredRule } from "../../utils/define-retired-rule.js";

export const tanstackStartNoDirectFetchInLoader = defineRetiredRule({
  id: "tanstack-start-no-direct-fetch-in-loader",
  severity: "warn",
  category: "Bugs",
  requires: ["tanstack-start"],
  tags: ["test-noise"],
  title: "Direct fetch in route loader",
  recommendation:
    "Retired: A loader can fetch public client-capable data directly. A fetch call alone does not require a server function.",
});
