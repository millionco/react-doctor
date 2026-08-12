import { escapeRegExp } from "./escape-reg-exp.js";

export const matchesIconifyCollectionReference = (
  content: string,
  packageName: string,
): boolean => {
  if (!packageName.startsWith("@iconify-json/")) return false;
  const collectionName = packageName.slice("@iconify-json/".length);
  if (!collectionName) return false;
  const escapedCollectionName = escapeRegExp(collectionName);
  return new RegExp(
    `(?:["'\`]${escapedCollectionName}:(?!(?:https?|data|mailto|tel)["'\`])[a-z0-9][a-z0-9_-]*["'\`]|~icons/${escapedCollectionName}/[a-z0-9][a-z0-9/_-]*)`,
  ).test(content);
};
