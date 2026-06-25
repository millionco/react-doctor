import { runEdit } from "./api";
import type { EditStatus, PackageJson } from "./api";

import { helperOne } from "./api";
import { helperTwo } from "./api";

export const status: EditStatus = { ok: true };
export const pkg: PackageJson = { name: helperOne() + helperTwo() };
export const value = runEdit(status);
