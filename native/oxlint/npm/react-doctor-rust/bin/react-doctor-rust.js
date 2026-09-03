#!/usr/bin/env node

import module from "node:module";
import { loadNativeBinding } from "./resolve-native-binding.js";

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {}
}

process.env.REACT_DOCTOR_NATIVE_OXLINT_BINDING_PATH = loadNativeBinding();
process.env.REACT_DOCTOR_NATIVE_OXLINT_REQUIRED = "1";
await import("react-doctor");
