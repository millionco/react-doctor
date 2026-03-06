---
name: react-doctor
description: Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project.
version: 1.0.0
---

# React Doctor

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics. Writes diagnostics.json and an HTML report (report.html) when issues are found; use `--open-report` to open the report in the browser.

## Usage

```bash
npx -y react-doctor@latest . --verbose --diff
```

Open the HTML report after the scan:

```bash
npx -y react-doctor@latest . --open-report
```

## Workflow

Run after making changes to catch issues early. Fix errors first, then re-run to verify the score improved.
