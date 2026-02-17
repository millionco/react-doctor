<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./assets/react-doctor-readme-logo-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./assets/react-doctor-readme-logo-light.svg">
  <img alt="React Doctor" src="./assets/react-doctor-readme-logo-light.svg" width="180" height="40">
</picture>

[![version](https://img.shields.io/npm/v/react-doctor?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)
[![downloads](https://img.shields.io/npm/dt/react-doctor.svg?style=flat&colorA=000000&colorB=000000)](https://npmjs.com/package/react-doctor)

Let coding agents diagnose and fix your React code.

One command scans your codebase for security, performance, correctness, and architecture issues, then outputs a **0–100 score** with actionable diagnostics.

### [See it in action →](https://react.doctor)

https://github.com/user-attachments/assets/07cc88d9-9589-44c3-aa73-5d603cb1c570

## Install

Run this at your project root:

```bash
npx -y react-doctor@latest .
```

Use `--verbose` to see affected files and line numbers:

```bash
npx -y react-doctor@latest . --verbose
```

## Install as a skill

Add React Doctor's rules as a [skill](https://skills.sh) for your coding agent:

```bash
npx skills add millionco/react-doctor
```

This gives agents like Cursor, Claude Code, Copilot, and others access to all 47+ React best practice rules. The CLI will also prompt to install the skill on first run.

## Options

```
Usage: react-doctor [directory] [options]

Options:
  -v, --version     display the version number
  --no-lint         skip linting
  --no-dead-code    skip dead code detection
  --verbose         show file details per rule
  --score           output only the score
  -y, --yes         skip prompts, scan all workspace projects
  --project <name>  select workspace project (comma-separated for multiple)
  --fix             open Ami to auto-fix all issues
  --prompt          copy latest scan output to clipboard
  -h, --help        display help for command
```

## Scores for popular open-source projects

| Project                                                | Score  | Share                                                                                   |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------- |
| [tldraw](https://github.com/tldraw/tldraw)             | **84** | [view](https://www.react.doctor/share?p=tldraw&s=84&e=98&w=139&f=40)                    |
| [excalidraw](https://github.com/excalidraw/excalidraw) | **84** | [view](https://www.react.doctor/share?p=%40excalidraw%2Fexcalidraw&s=84&e=2&w=196&f=80) |
| [twenty](https://github.com/twentyhq/twenty)           | **78** | [view](https://www.react.doctor/share?p=twenty-front&s=78&e=99&w=293&f=268)             |
| [plane](https://github.com/makeplane/plane)            | **78** | [view](https://www.react.doctor/share?p=web&s=78&e=7&w=525&f=292)                       |
| [formbricks](https://github.com/formbricks/formbricks) | **75** | [view](https://www.react.doctor/share?p=%40formbricks%2Fweb&s=75&e=15&w=389&f=242)      |
| [posthog](https://github.com/PostHog/posthog)          | **72** | [view](https://www.react.doctor/share?p=%40posthog%2Ffrontend&s=72&e=82&w=1177&f=585)   |
| [supabase](https://github.com/supabase/supabase)       | **69** | [view](https://www.react.doctor/share?p=studio&s=69&e=74&w=1087&f=566)                  |
| [onlook](https://github.com/onlook-dev/onlook)         | **69** | [view](https://www.react.doctor/share?p=%40onlook%2Fweb-client&s=69&e=64&w=418&f=178)   |
| [payload](https://github.com/payloadcms/payload)       | **68** | [view](https://www.react.doctor/share?p=%40payloadcms%2Fui&s=68&e=139&w=408&f=298)      |
| [cal.com](https://github.com/calcom/cal.com)           | **63** | [view](https://www.react.doctor/share?p=%40calcom%2Fweb&s=63&e=31&w=558&f=311)          |
| [dub](https://github.com/dubinc/dub)                   | **62** | [view](https://www.react.doctor/share?p=web&s=62&e=52&w=966&f=457)                      |

## Contributing

Want to contribute? Check out the codebase and submit a PR.

```bash
git clone https://github.com/millionco/react-doctor
cd react-doctor
pnpm install
pnpm -r run build
```

Run locally:

```bash
node packages/react-doctor/dist/cli.js /path/to/your/react-project
```

### License

React Doctor is MIT-licensed open-source software.
