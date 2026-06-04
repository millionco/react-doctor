#!/usr/bin/env node

import module from "node:module";

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore compile-cache errors.
  }
}

const { startLanguageServer } = await import("../dist/index.js");

startLanguageServer();
