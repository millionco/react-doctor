# React Doctor

Use when finishing a feature, fixing a bug, before committing React code, or when the user wants to improve code quality or clean up a codebase.

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score covering lint, dead code, accessibility, bundle size, and architecture diagnostics.

## After making React code changes:

Run `npx -y react-doctor@latest . --verbose --diff` and check the score did not regress.

## For general cleanup:

Run `npx -y react-doctor@latest . --verbose` to scan the full codebase. Fix errors first, then warnings.
