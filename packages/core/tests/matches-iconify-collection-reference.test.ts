import { describe, expect, it } from "vite-plus/test";
import { matchesIconifyCollectionReference } from "../src/project-analysis/utils/matches-iconify-collection-reference.js";

describe("matchesIconifyCollectionReference", () => {
  it.each([
    [`<Icon name="lucide:chevron-left" />`, "@iconify-json/lucide"],
    [`const icon = 'fa6-solid:chart-gantt';`, "@iconify-json/fa6-solid"],
    [`import icon from "~icons/mdi/account";`, "@iconify-json/mdi"],
  ])("matches a collection selected by a virtual icon reference", (content, packageName) => {
    expect(matchesIconifyCollectionReference(content, packageName)).toBe(true);
  });

  it.each([
    [`const protocol = "lucide:https";`, "@iconify-json/lucide"],
    [`const icon = "lucide-react:check";`, "@iconify-json/lucide"],
    [`const icon = "fa:check";`, "@iconify-json/fa6-solid"],
    [`const icon = "lucide:check";`, "lucide"],
    [`const namespace = "ri"; const name = "search-line";`, "@iconify-json/ri"],
  ])("rejects unrelated colon strings and collection-name collisions", (content, packageName) => {
    expect(matchesIconifyCollectionReference(content, packageName)).toBe(false);
  });
});
