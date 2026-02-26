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
---
name: react-doctor
description: Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project.
version: 1.0.0
---

# React Doctor

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## Usage

\\\`\\\`\\\`bash
npx -y react-doctor@latest . --verbose --diff
\\\`\\\`\\\`

## Workflow

Run after making changes to catch issues early. Fix errors first, then re-run to verify the score improved.
EOF
)

AGENTS_CONTENT=$(cat << 'EOF'
# React Doctor

Run after making React changes to catch issues early. Use when reviewing code, finishing a feature, or fixing bugs in a React project.

Scans your React codebase for security, performance, correctness, and architecture issues. Outputs a 0-100 score with actionable diagnostics.

## Usage

\\\`\\\`\\\`bash
npx -y react-doctor@latest . --verbose --diff
\\\`\\\`\\\`

## Workflow

Run after making changes to catch issues early. Fix errors first, then re-run to verify the score improved.
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
  echo "  • Ami: https://ami.dev"
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
