import * as assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkReactProofReport,
  proveReactApp,
  ReactAppProofStatus,
  ReactProofCertificateStatus,
} from "../dist/index.js";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtureRoot = path.join(packageRoot, "tests/fixtures/proved-returned-event-handler");
const report = proveReactApp({ rootDirectory: fixtureRoot });
const certificate = checkReactProofReport(report);

assert.equal(report.status, ReactAppProofStatus.Proved);
assert.equal(certificate.status, ReactProofCertificateStatus.Valid);
