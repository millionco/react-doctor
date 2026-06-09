#!/usr/bin/env bash
#
# Scaffold the boilerplate for a new SlopBench task (task.toml, tests/test.sh,
# environment/Dockerfile, solution/solve.sh). You still author seed/,
# instruction.md, the reference solution, and the hidden test — then run
# scripts/gen-task-patches.sh to produce solution.patch + test.patch.
#
# Usage:
#   scripts/scaffold-task.sh <id> <family> <dims-csv> <functional-cmd> [--needs-install] "<title>" "<desc>"
set -euo pipefail

BENCH_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ID="$1"; FAMILY="$2"; DIMS_CSV="$3"; FUNC_CMD="$4"; shift 4
NEEDS_INSTALL="no"
if [ "${1:-}" = "--needs-install" ]; then NEEDS_INSTALL="yes"; shift; fi
TITLE="${1:-$ID}"; DESC="${2:-$ID}"
TASK_DIR="$BENCH_ROOT/tasks/$ID"
DIMS_TOML="$(python3 -c "import sys;print(', '.join('\"%s\"'%d for d in sys.argv[1].split(',') for d in [d.strip()] if d))" "$DIMS_CSV")"

mkdir -p "$TASK_DIR/tests" "$TASK_DIR/environment" "$TASK_DIR/solution"

cat > "$TASK_DIR/task.toml" <<EOF
schema_version = "1.1"
artifacts = []

[task]
name = "slopbench/$ID"
description = "$DESC"
authors = []
keywords = ["react", "typescript", "slop", "frontend"]

[metadata]
task_id = "$ID"
display_title = "$TITLE"
display_description = "$DESC"
family = "$FAMILY"
target_dimensions = [$DIMS_TOML]
language = "typescript"
repository_url = "in-tree"
base_commit_hash = "root"
slop_profile = ""

[verifier]
timeout_sec = 1200.0

[verifier.env]

[agent]
timeout_sec = 3600.0

[environment]
build_timeout_sec = 1200.0
docker_image = "slopbench-base:latest"
os = "linux"
cpus = 2
memory_mb = 4096
storage_mb = 10240
gpus = 0
allow_internet = false
mcp_servers = []

[environment.env]

[solution.env]
EOF

cat > "$TASK_DIR/tests/test.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export BASE_COMMIT="\$(git -C "\${APP_DIR:-/app}" rev-list --max-parents=0 HEAD | tail -1)"
export FUNCTIONAL_TEST_CMD="$FUNC_CMD"
exec slopbench-grade
EOF

if [ "$NEEDS_INSTALL" = "yes" ]; then
  INSTALL_STEP='RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts'
else
  INSTALL_STEP='# Pure-TS task: no dependency install (functional test uses node --test).'
fi

cat > "$TASK_DIR/environment/Dockerfile" <<EOF
FROM slopbench-base:latest

WORKDIR /app

COPY seed/ .
$INSTALL_STEP
RUN git init -q \\
  && git add -A \\
  && git -c user.email=bench@react.doctor -c user.name=slopbench commit -qm "base" \\
  && git config --global --add safe.directory /app

CMD ["/bin/bash"]
EOF

cat > "$TASK_DIR/solution/solve.sh" <<'EOF'
#!/usr/bin/env bash
# Reference solution applier (reviewer aid only — never used at grade time).
set -euo pipefail
cd /app
git apply --whitespace=nowarn /solution/solution.patch
EOF

chmod +x "$TASK_DIR/tests/test.sh" "$TASK_DIR/solution/solve.sh"
echo "scaffolded $TASK_DIR (author seed/, instruction.md, then gen-task-patches.sh)"
