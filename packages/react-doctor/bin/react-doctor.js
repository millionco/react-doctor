#!/usr/bin/env node

import module from "node:module";

if (module.enableCompileCache && !process.env.NODE_DISABLE_COMPILE_CACHE) {
  try {
    module.enableCompileCache();
  } catch {
    // Ignore compile-cache errors.
  }
}

// Fast-path the (experimental) language server so it runs without the CLI's
// commander / prompts / ora layer, which would touch process.stdin before the
// LSP connection attaches and break the stdio transport.
if (process.argv[2] === "experimental-lsp") {
  const { startLanguageServer } = await import("../dist/lsp.js");
  startLanguageServer();
} else {
  await import("../dist/cli.js");
}
