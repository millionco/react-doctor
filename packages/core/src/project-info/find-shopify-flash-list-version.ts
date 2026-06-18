import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";
import { getDependencySpec } from "./utils/get-dependency-spec.js";

export const SHOPIFY_FLASH_LIST_PACKAGE_NAME = "@shopify/flash-list";

export const findShopifyFlashListVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    getDependencySpec(packageJson, SHOPIFY_FLASH_LIST_PACKAGE_NAME),
  );
