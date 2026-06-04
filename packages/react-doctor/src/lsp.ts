/**
 * Dedicated language-server entry for `react-doctor experimental-lsp`. The bin shim
 * fast-paths to this module so the server runs without loading the CLI
 * (commander / prompts / ora), which would otherwise touch `process.stdin`
 * before the LSP connection attaches and break the stdio transport.
 */
export { startLanguageServer } from "@react-doctor/language-server";
