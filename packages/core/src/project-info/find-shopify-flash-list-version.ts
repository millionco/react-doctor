import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";

export const SHOPIFY_FLASH_LIST_PACKAGE_NAME = "@shopify/flash-list";

const getShopifyFlashListDependencySpec = (packageJson: PackageJson): string | null => {
  const spec =
    packageJson.dependencies?.[SHOPIFY_FLASH_LIST_PACKAGE_NAME] ??
    packageJson.devDependencies?.[SHOPIFY_FLASH_LIST_PACKAGE_NAME] ??
    packageJson.peerDependencies?.[SHOPIFY_FLASH_LIST_PACKAGE_NAME] ??
    packageJson.optionalDependencies?.[SHOPIFY_FLASH_LIST_PACKAGE_NAME];
  return typeof spec === "string" ? spec : null;
};

export const findShopifyFlashListVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, getShopifyFlashListDependencySpec);
