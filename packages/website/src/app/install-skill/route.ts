// HACK: this route serves the `curl | bash` installer that's linked
// from the website's "install" CTA. Rather than reimplement agent
// detection + skill copying in shell (which had drifted out of sync
// with the canonical JS implementation in
// packages/react-doctor/src/install-skill.ts — wrong paths, missing
// agents like Copilot/Droid/Pi, and obsolete agents like Amp/Antigravity/
// Windsurf), we just delegate to the JS CLI: `npx react-doctor install --yes`.
//
// The JS CLI is the single source of truth for:
//   - which agents we support (claude, codex, copilot, gemini, cursor,
//     opencode, droid, pi)
//   - where each agent's skill directory lives (.claude/skills,
//     .factory/skills, .agents/skills, etc.) — all PROJECT-LOCAL
//   - what content to ship (the bundled skills/react-doctor/ directory,
//     including SKILL.md, AGENTS.md, and any future YAML descriptors)
//
// Keeping this script tiny means web-installed users always get the
// same behavior as `npx react-doctor install`.
const INSTALL_SCRIPT = `#!/bin/bash
set -e

if [ -t 1 ]; then
  GREEN='\\033[32m'
  RESET='\\033[0m'
else
  GREEN=''
  RESET=''
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found — install Node.js first: https://nodejs.org" >&2
  exit 1
fi

printf "\${GREEN}→\${RESET} Installing react-doctor skill via npx react-doctor install...\\n"
exec npx -y react-doctor@latest install --yes
`;

export const GET = (): Response =>
  new Response(INSTALL_SCRIPT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="install.sh"',
    },
  });
