---
"react-doctor": minor
---

Add an "Add to CI" path to the post-scan handoff and make `install` set up CI by default.

The post-scan prompt now leads with an "Add to CI" choice (the default) that installs the `react-doctor` dev dependency + `doctor` script and writes a `.github/workflows/react-doctor.yml` GitHub Actions workflow so every pull request is scanned. When you instead hand off to an agent, the generated prompt now asks the agent to offer CI setup first. The `install` subcommand pre-selects the workflow and `install --yes` now writes it by default. The workflow's action is pinned to the `@v1` floating major (never `@main`, per the supply-chain guidance in issue #299).
