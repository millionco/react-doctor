import type { PackageJson } from "../types/index.js";
import { findWorkspaceDependencySpec } from "./find-workspace-dependency-spec.js";

export const SHOPIFY_FLASH_LIST_PACKAGE_NAME = "@shopify/flash-list";

export const findShopifyFlashListVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findWorkspaceDependencySpec(rootDirectory, rootPackageJson, SHOPIFY_FLASH_LIST_PACKAGE_NAME);
