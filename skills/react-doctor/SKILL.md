---
name: react-doctor
description: Runs react-doctor to lint, type-check, and scan React components for security, performance, and correctness issues. Use when validating changes, checking for errors, running diagnostics, or auditing a React codebase before shipping.
version: 1.0.0
---

# React Doctor

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## Usage

```bash
npx -y react-doctor@latest . --verbose --diff
```

## Workflow

1. Run react-doctor after making changes.
2. Fix **errors** first (security, correctness), then **warnings** (performance, architecture).
3. Re-run to verify the score improved. Aim for 80+ on a healthy codebase.
