---
name: react-doctor
description: Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project.
metadata: {
  version: 1.1.0
}
---

# React Doctor

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## When to Use

- After modifying hook logic (`useEffect`, `useMemo`, custom hooks).
- When detecting rendering slowdowns or performance regressions.
- Before committing changes to ensure a score > 75.

## Usage

```bash
npx -y react-doctor@latest [directory] [options] [command] 
```

### Main Commands
- **Full Diagnosis (Automatic)**: `npx -y react-doctor@latest . --verbose --yes` (Scans all files and skips prompts)
- **Quick Diagnosis (Uncommitted only)**: `npx -y react-doctor@latest . --verbose` (Then answer 'Y' to the prompt)
- **Score Only**: `npx -y react-doctor@latest . --score`
- **Auto-fix (via Ami)**: `npx -y react-doctor@latest . --fix`

### Analysis Rules

#### 1. Full Analysis (Complete Project)
To perform a **complete analysis** of the entire codebase:
- **Option A (Automatic)**: Use the `--yes` or `-y` flag.
  - Command: `npx -y react-doctor@latest . --verbose --yes`
- **Option B (Interactive)**: Run without `-y` and when prompted:
  - Prompt: `? Found X uncommitted changed files. Only scan current changes? › (Y/n)`
  - Response: **`n`** (No, I want to scan everything).

#### 2. Quick Analysis (Uncommitted Changes)
To perform a **fast analysis** only on the files you have modified but not yet committed:
1. Run: `npx -y react-doctor@latest . --verbose` (Omit the `-y` flag)
2. When prompted: `? Found X uncommitted changed files. Only scan current changes? › (Y/n)`
3. Respond with: **`Y`** (Yes, only scan current changes).
*This is the recommended workflow for rapid iteration during development.*

### Arguments
- `directory`: project directory to scan (default: ".")

### Options
- `-v, --version`: display the version number
- `--lint`: enable linting
- `--no-lint`: skip linting
- `--dead-code`: enable dead code detection
- `--no-dead-code`: skip dead code detection
- `--verbose`: show file details per rule
- `--score`: output only the score
- `-y, --yes`: skip prompts and scan the entire codebase (recommended for full audits)
- `--project <name>`: select workspace project (comma-separated for multiple)
- `--diff [base]`: scan only files changed vs base branch
- `--offline`: skip telemetry (anonymous, not stored, only used to calculate score)
- `--ami`: enable Ami-related prompts
- `--fail-on <level>`: exit with error code on diagnostics: error, warning, none (default: "none")
- `--fix`: open Ami to auto-fix all issues
- `-h, --help`: display help for command

## Workflow (Guidelines)

1. **Iteration Strategy**: Use **Quick Analysis** while coding to fix immediate issues. Use **Full Analysis** before final commits or PRs.
2. **Scan & Analyze**: Execute the diagnosis and prioritize Errors over Warnings.
3. **Threshold**: If the score is < 75, you MUST prioritize fixing:
   - **Security**: `eval` usage, exposed secrets.
   - **Correctness**: Missing keys in lists, asynchronous closures.
4. **Auto-remediation**: Use the "Ami" tool (`--fix`) for automatic corrections when available.
5. **Architectural Integrity**: Always verify that refactoring doesn't break modular architecture (e.g., avoid components > 300 lines).
6. **Validation**: Re-run the scan after fixing to verify the score improvement.
