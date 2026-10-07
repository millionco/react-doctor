import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isJsxAttributeOnIntrinsicHtmlElement } from "./is-on-intrinsic-html-element.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const shouldSkipReactPerfNativeAttribute = (
  node: EsTreeNodeOfType<"JSXAttribute">,
  settings: Readonly<Record<string, unknown>> | undefined,
  settingsKey: string,
  shouldUseCuratedBehavior: boolean,
): boolean => {
  if (!isJsxAttributeOnIntrinsicHtmlElement(node)) return false;
  if (shouldUseCuratedBehavior) return true;
  const reactDoctorSettings = settings?.["react-doctor"];
  if (typeof reactDoctorSettings !== "object" || reactDoctorSettings === null) return false;
  const ruleSettings = Reflect.get(reactDoctorSettings, settingsKey);
  if (typeof ruleSettings !== "object" || ruleSettings === null) return false;
  const nativeAllowList = Reflect.get(ruleSettings, "nativeAllowList");
  if (nativeAllowList === "all") return true;
  if (!Array.isArray(nativeAllowList) || !isNodeOfType(node.name, "JSXIdentifier")) return false;
  const attributeName = node.name.name.toLowerCase();
  return nativeAllowList.some(
    (allowedName) => typeof allowedName === "string" && allowedName.toLowerCase() === attributeName,
  );
};
