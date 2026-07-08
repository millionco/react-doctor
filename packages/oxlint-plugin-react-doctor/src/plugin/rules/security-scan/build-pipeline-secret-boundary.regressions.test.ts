import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { buildPipelineSecretBoundary } from "./build-pipeline-secret-boundary.js";

describe("security-scan/build-pipeline-secret-boundary — regressions", () => {
  it("stays silent when secrets are step-scoped to later steps (trendyol betapublish shape)", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/betapublish.yml",
      content: `jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install
        run: npm install
      - name: Test
        run: npm run test
      - uses: codecov/codecov-action@v4
        env:
          CODECOV_TOKEN: \${{ secrets.CODECOV_TOKEN }}
      - name: Publish
        run: npm publish --access=public --tag beta
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when the secret is a with: input of a later action step (mapguide coveralls shape)", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/main.yml",
      content: `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install dependencies
        run: yarn install
      - name: Coveralls
        uses: coverallsapp/github-action@v2
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when secrets appear only inline in later run steps (innovaccer release shape)", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/main.yml",
      content: `jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: npm install
        run: npm ci
      - name: Publish to npmjs
        run: npm publish --access public
        env:
          NPM_TOKEN: \${{secrets.NPM_TOKEN}}
      - name: push module tags to github
        run: git push https://\${{ secrets.GH_TOKEN }}@github.com/$GITHUB_REPOSITORY.git
      - name: notify release
        env:
          GCHAT_PATH: \${{ secrets.GCHAT_PATH }}
        run: ./notify.sh
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags an install step whose own env carries secrets", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/release.yml",
      content: `jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install
        env:
          FIREBASE_ADMIN_KEY: \${{ secrets.FIREBASE_ADMIN_KEY }}
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags installs when secrets sit in workflow-level env shared by every step", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/ci.yml",
      content: `env:
  NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install
        run: npm ci
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags installs when secrets sit in job-level env", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/ci.yml",
      content: `jobs:
  build:
    runs-on: ubuntu-latest
    env:
      DEPLOY_KEY: \${{ secrets.DEPLOY_KEY }}
    steps:
      - name: Install
        run: yarn install
`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when the co-located install disables lifecycle scripts", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: ".github/workflows/test.yml",
      content: `steps:
  - run: pnpm install --ignore-scripts
    env:
      RELEASE_TOKEN: \${{ secrets.RELEASE_TOKEN }}
`,
    });
    expect(findings).toHaveLength(0);
  });

  it("keeps the proximity heuristic for non-workflow config files", () => {
    const findings = runScanRule(buildPipelineSecretBoundary, {
      relativePath: "Dockerfile",
      content: `ARG NPM_TOKEN\nRUN echo "//registry.npmjs.org/:_authToken=\${secrets.NPM_TOKEN}" > .npmrc && npm install\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
