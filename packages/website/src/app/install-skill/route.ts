// HACK: this route serves the `curl | bash` installer that's linked
// from the website's "install" CTA. Rather than reimplement agent
// detection + skill copying in shell, we just delegate to the JS CLI:
// `npx react-doctor install --yes`.
//
// The JS CLI delegates to the `agent-install` package for the full
// agent registry (Claude Code, Codex, Cursor, Factory Droid, Gemini CLI,
// GitHub Copilot, Goose, OpenCode, Pi, Windsurf, Roo Code, Cline, Kilo
// Code) and where each agent's skill directory lives (.claude/skills,
// .factory/skills, .agents/skills, etc., all PROJECT-LOCAL). Keeping
// this script tiny means web-installed users always get the same
// behavior as `npx react-doctor install`.
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
