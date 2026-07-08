// One-shot analyze runner for tests that need cross-PROCESS cache semantics
// (the resolver keeps module-level fs/content caches, so a config-file content
// edit is only observable from a fresh process — exactly how react-doctor's
// dead-code worker runs deslop). Reads a partial DeslopConfig as argv JSON and
// prints the ScanResult as JSON (DeslopError serializes via toJSON).
import { analyze, defineConfig } from "../../src/index.js";

const config = JSON.parse(process.argv[2]);
const result = await analyze(defineConfig(config));
process.stdout.write(JSON.stringify(result));
