// HACK: SKILL_MD_CONTENT and AGENTS_MD_CONTENT must stay in sync with the
// canonical skills/react-doctor/{SKILL,AGENTS}.md at the repo root. The
// react-doctor package's `tests/install-skill-content.test.ts` asserts this
// at CI time. We embed the content rather than fs.readFileSync because
// Next.js routes deployed to Vercel can't reliably read across-package
// files at runtime.
const SKILL_MD_CONTENT = `---
name: react-doctor
description: Use when finishing a feature, fixing a bug, before committing React code, or when the user wants to improve code quality or clean up a codebase. Checks for score regression. Covers lint, dead code, accessibility, bundle size, architecture diagnostics.
version: "1.0.0"
---

# React Doctor

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score.

## After making React code changes:

Run \\\`npx -y react-doctor@latest . --verbose --diff\\\` and check the score did not regress.

If the score dropped, fix the regressions before committing.

## For general cleanup or code improvement:

Run \\\`npx -y react-doctor@latest . --verbose\\\` (without \\\`--diff\\\`) to scan the full codebase. Fix issues by severity — errors first, then warnings.

## Command

\\\`\\\`\\\`bash
npx -y react-doctor@latest . --verbose --diff
\\\`\\\`\\\`

| Flag        | Purpose                                       |
| ----------- | --------------------------------------------- |
| \\\`.\\\`         | Scan current directory                        |
| \\\`--verbose\\\` | Show affected files and line numbers per rule |
| \\\`--diff\\\`    | Only scan changed files vs base branch        |
| \\\`--score\\\`   | Output only the numeric score                 |`;

const AGENTS_MD_CONTENT = `# React Doctor

Use when finishing a feature, fixing a bug, before committing React code, or when the user wants to improve code quality or clean up a codebase.

Scans React codebases for security, performance, correctness, and architecture issues. Outputs a 0–100 health score covering lint, dead code, accessibility, bundle size, and architecture diagnostics.

## After making React code changes:

Run \\\`npx -y react-doctor@latest . --verbose --diff\\\` and check the score did not regress.

## For general cleanup:

Run \\\`npx -y react-doctor@latest . --verbose\\\` to scan the full codebase. Fix errors first, then warnings.`;

const INSTALL_SCRIPT = `#!/bin/bash
set -e

if [ -t 1 ]; then
  GREEN='\\033[32m'
  DIM='\\033[2m'
  RESET='\\033[0m'
else
  GREEN=''
  DIM=''
  RESET=''
fi

SKILL_NAME="react-doctor"
INSTALLED=0

SKILL_CONTENT=$(cat << 'EOF'
${SKILL_MD_CONTENT}
EOF
)

AGENTS_CONTENT=$(cat << 'EOF'
${AGENTS_MD_CONTENT}
EOF
)

echo "Installing React Doctor skill..."
echo ""

# Claude Code
if [ -d "$HOME/.claude" ]; then
  SKILL_DIR="$HOME/.claude/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DIR"
  printf '%s\\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$SKILL_DIR/AGENTS.md"
  printf "\${GREEN}✔\${RESET} Claude Code\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# Amp Code
if [ -d "$HOME/.amp" ]; then
  SKILL_DIR="$HOME/.config/amp/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DIR"
  printf '%s\\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$SKILL_DIR/AGENTS.md"
  printf "\${GREEN}✔\${RESET} Amp Code\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# Cursor
if [ -d "$HOME/.cursor" ]; then
  SKILL_DIR="$HOME/.cursor/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DIR"
  printf '%s\\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$SKILL_DIR/AGENTS.md"
  printf "\${GREEN}✔\${RESET} Cursor\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# OpenCode
if command -v opencode &> /dev/null || [ -d "$HOME/.config/opencode" ]; then
  SKILL_DIR="$HOME/.config/opencode/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DIR"
  printf '%s\\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$SKILL_DIR/AGENTS.md"
  printf "\${GREEN}✔\${RESET} OpenCode\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# Windsurf
MARKER="# React Doctor"
if [ -d "$HOME/.codeium" ] || [ -d "$HOME/Library/Application Support/Windsurf" ]; then
  mkdir -p "$HOME/.codeium/windsurf/memories"
  RULES_FILE="$HOME/.codeium/windsurf/memories/global_rules.md"
  if [ -f "$RULES_FILE" ] && grep -q "$MARKER" "$RULES_FILE"; then
    printf "\${GREEN}✔\${RESET} Windsurf \${DIM}(already installed)\${RESET}\\n"
  else
    if [ -f "$RULES_FILE" ]; then
      echo "" >> "$RULES_FILE"
    fi
    echo "$MARKER" >> "$RULES_FILE"
    echo "" >> "$RULES_FILE"
    printf '%s\\n' "$SKILL_CONTENT" >> "$RULES_FILE"
    printf "\${GREEN}✔\${RESET} Windsurf\\n"
  fi
  INSTALLED=$((INSTALLED + 1))
fi

# Antigravity
if command -v agy &> /dev/null || [ -d "$HOME/.gemini/antigravity" ]; then
  SKILL_DIR="$HOME/.gemini/antigravity/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DIR"
  printf '%s\\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$SKILL_DIR/AGENTS.md"
  printf "\${GREEN}✔\${RESET} Antigravity\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# Gemini CLI
if command -v gemini &> /dev/null || [ -d "$HOME/.gemini" ]; then
  mkdir -p "$HOME/.gemini/skills/$SKILL_NAME"
  printf '%s\\n' "$SKILL_CONTENT" > "$HOME/.gemini/skills/$SKILL_NAME/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$HOME/.gemini/skills/$SKILL_NAME/AGENTS.md"
  printf "\${GREEN}✔\${RESET} Gemini CLI\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# Codex
if command -v codex &> /dev/null || [ -d "$HOME/.codex" ]; then
  SKILL_DIR="$HOME/.codex/skills/$SKILL_NAME"
  mkdir -p "$SKILL_DIR"
  mkdir -p "$SKILL_DIR/agents"
  printf '%s\\n' "$SKILL_CONTENT" > "$SKILL_DIR/SKILL.md"
  printf '%s\\n' "$AGENTS_CONTENT" > "$SKILL_DIR/AGENTS.md"
  cat > "$SKILL_DIR/agents/openai.yaml" << 'YAMLEOF'
interface:
  display_name: "react-doctor"
  short_description: "Diagnose and fix React codebase health issues"
YAMLEOF
  printf "\${GREEN}✔\${RESET} Codex\\n"
  INSTALLED=$((INSTALLED + 1))
fi

# Project-level .agents/
AGENTS_DIR=".agents/$SKILL_NAME"
mkdir -p "$AGENTS_DIR"
printf '%s\\n' "$SKILL_CONTENT" > "$AGENTS_DIR/SKILL.md"
printf '%s\\n' "$AGENTS_CONTENT" > "$AGENTS_DIR/AGENTS.md"
printf "\${GREEN}✔\${RESET} .agents/\\n"
INSTALLED=$((INSTALLED + 1))

echo ""
if [ $INSTALLED -eq 0 ]; then
  echo "No supported tools detected."
  echo ""
  echo "Install one of these first:"
  echo "  • Amp Code: https://ampcode.com"
  echo "  • Antigravity: https://antigravity.google"
  echo "  • Claude Code: https://claude.ai/code"
  echo "  • Codex: https://codex.openai.com"
  echo "  • Cursor: https://cursor.com"
  echo "  • Gemini CLI: https://github.com/google-gemini/gemini-cli"
  echo "  • OpenCode: https://opencode.ai"
  echo "  • Windsurf: https://codeium.com/windsurf"
  exit 1
fi

echo "Done! The skill will activate when working on React projects."
`;

export const GET = (): Response =>
  new Response(INSTALL_SCRIPT, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="install.sh"',
    },
  });
