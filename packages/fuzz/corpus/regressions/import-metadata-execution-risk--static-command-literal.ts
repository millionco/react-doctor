// rule: import-metadata-execution-risk
// verdict: pass
// weakness: name-heuristic
// source: private workspace false-positive review

import { execSync } from "node:child_process";

execSync(`ci-agent pipeline upload generated-steps.json`);
