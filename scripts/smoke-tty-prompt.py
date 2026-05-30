#!/usr/bin/env python3
"""Smoke test: the interactive multiselect prompt must survive in a real TTY.

Regression guard for #576. The CLI unrefs `process.stdin` at startup so
one-shot non-interactive runs (e.g. `--json` launched by an eval runner that
holds the stdin pipe open) can exit cleanly. The fix MUST NOT unref an
interactive TTY: `prompts` never re-refs an unref'd stdin handle, so unref-ing
a terminal lets the event loop drain while the prompt is still waiting for
input — the CLI renders the prompt and then exits by itself (code 0) before
the user can answer.

A real terminal is the only environment that exposes this bug (`isTTY` gates
the unref), so this test allocates a genuine pseudo-terminal with
`pty.openpty()` — Node has no built-in PTY and the `script(1)` utility needs
the parent's stdin to itself be a TTY, which CI runners don't provide. Python's
`pty` module is preinstalled on every GitHub-hosted runner (Linux + macOS) and
needs no native build.

Verdict:
  PASS  -> the prompt rendered AND the process was still alive when we killed
           it at the timeout (the TTY held the event loop open, as it must).
  FAIL  -> the process exited on its own (the #576 regression: "dies by
           itself"), or the prompt never rendered (setup/environment problem).
"""

import json
import os
import pty
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI_BINARY_PATH = os.path.join(REPOSITORY_ROOT, "packages", "react-doctor", "dist", "cli.js")

# If the prompt is still open this long after the CLI started, the event loop
# is being held open correctly. The regression self-exits within ~100ms of the
# prompt rendering, so this window has a wide safety margin for slow CI cold
# starts.
STAY_ALIVE_WINDOW_SECONDS = 6.0
PROMPT_MARKER = "Select projects"

# Env vars that make `shouldSkipPrompts()` short-circuit to non-interactive
# (so the multiselect would never render). CI sets CI / GITHUB_ACTIONS, and a
# coding agent may set CURSOR_AGENT etc., so we strip the full set the CLI
# consults to force the genuine interactive code path. Keep in sync with
# `is-non-interactive-environment.ts` + `is-ci-environment.ts`.
NON_INTERACTIVE_ENVIRONMENT_VARIABLES = (
    "CI",
    "GITHUB_ACTIONS",
    "GITLAB_CI",
    "BUILDKITE",
    "JENKINS_URL",
    "TF_BUILD",
    "CODEBUILD_BUILD_ID",
    "TEAMCITY_VERSION",
    "BITBUCKET_BUILD_NUMBER",
    "CIRCLECI",
    "TRAVIS",
    "DRONE",
    "GIT_DIR",
    "CLAUDECODE",
    "CLAUDE_CODE",
    "CURSOR_AGENT",
    "CODEX_CI",
    "CODEX_SANDBOX",
    "CODEX_SANDBOX_NETWORK_DISABLED",
    "OPENCODE",
    "GOOSE_TERMINAL",
    "AGENT_SESSION_ID",
    "AMP_THREAD_ID",
    "AGENT_THREAD_ID",
    "AGENT",
)


def fail(message):
    print(f"Smoke FAIL: {message}", file=sys.stderr)
    sys.exit(1)


def resolve_node_binary():
    node_path = shutil.which("node")
    if node_path is None:
        fail("`node` not found on PATH.")
    return node_path


NODE_BINARY_PATH = resolve_node_binary()


def write_package_json(directory, contents):
    os.makedirs(directory, exist_ok=True)
    with open(os.path.join(directory, "package.json"), "w", encoding="utf-8") as handle:
        json.dump(contents, handle)


def create_workspace_fixture(root_directory):
    """A minimal monorepo with two React packages so the CLI shows the
    multiselect "Select projects" prompt (>= 2 workspace packages with a React
    dependency)."""
    write_package_json(
        root_directory,
        {"name": "rd-tty-smoke-root", "private": True, "version": "0.0.0", "workspaces": ["packages/*"]},
    )
    for package_name in ("app-a", "app-b"):
        package_directory = os.path.join(root_directory, "packages", package_name)
        write_package_json(
            package_directory,
            {"name": package_name, "version": "0.0.0", "dependencies": {"react": "18.3.1"}},
        )
        source_directory = os.path.join(package_directory, "src")
        os.makedirs(source_directory, exist_ok=True)
        with open(os.path.join(source_directory, "index.tsx"), "w", encoding="utf-8") as handle:
            handle.write("export const Component = () => null;\n")


def run_prompt_in_pty(fixture_directory):
    child_environment = {
        key: value
        for key, value in os.environ.items()
        if key not in NON_INTERACTIVE_ENVIRONMENT_VARIABLES
    }
    child_environment["FORCE_COLOR"] = "0"

    master_fd, slave_fd = pty.openpty()
    process = subprocess.Popen(
        [NODE_BINARY_PATH, CLI_BINARY_PATH, fixture_directory, "--no-lint", "--no-dead-code", "--no-score"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=child_environment,
        close_fds=True,
    )
    os.close(slave_fd)

    captured_output = b""
    deadline = time.time() + STAY_ALIVE_WINDOW_SECONDS
    while time.time() < deadline and process.poll() is None:
        readable, _, _ = select.select([master_fd], [], [], 0.2)
        if not readable:
            continue
        try:
            chunk = os.read(master_fd, 4096)
        except OSError:
            chunk = b""
        if chunk:
            captured_output += chunk
    os.close(master_fd)

    exited_by_itself = process.poll() is not None
    if not exited_by_itself:
        process.send_signal(signal.SIGKILL)
        process.wait()

    return exited_by_itself, captured_output.decode("utf-8", "replace")


def main():
    if not os.path.isfile(CLI_BINARY_PATH):
        fail(f"Built CLI missing at {CLI_BINARY_PATH}. Run `pnpm build` first.")

    fixture_directory = tempfile.mkdtemp(prefix="react-doctor-tty-smoke-")
    try:
        create_workspace_fixture(fixture_directory)
        exited_by_itself, output = run_prompt_in_pty(fixture_directory)
    finally:
        shutil.rmtree(fixture_directory, ignore_errors=True)

    prompt_rendered = PROMPT_MARKER in output

    if not prompt_rendered:
        print(output[:1000], file=sys.stderr)
        fail(
            f'The "{PROMPT_MARKER}" prompt never rendered in the PTY — the CLI '
            "did not reach interactive project selection (env/setup problem)."
        )

    if exited_by_itself:
        print(output[:1000], file=sys.stderr)
        fail(
            "The CLI exited on its own while an interactive prompt was open "
            "(the #576 unref-stdin regression: prompts die by themselves)."
        )

    print(
        f'Smoke OK: "{PROMPT_MARKER}" prompt rendered in a real PTY and the '
        "process stayed alive waiting for input (held the event loop open)."
    )


if __name__ == "__main__":
    main()
