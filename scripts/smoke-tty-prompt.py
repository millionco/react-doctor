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
  PASS  -> the prompt rendered, stayed alive waiting for input, and showed the
           scan indicator before a deliberately delayed git lookup completed.
  FAIL  -> the process exited on its own (the #576 regression: "dies by
           itself"), the prompt never rendered, or scan feedback arrived late.
"""

import argparse
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import subprocess
import struct
import sys
import tempfile
import termios
import time

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CLI_BINARY_PATH = os.path.join(REPOSITORY_ROOT, "packages", "react-doctor", "dist", "cli.js")

# If the prompt is still open this long after the CLI started, the event loop
# is being held open correctly. The regression self-exits within ~100ms of the
# prompt rendering, so this window has a wide safety margin for slow CI cold
# starts.
STAY_ALIVE_WINDOW_SECONDS = 6.0
PROMPT_STABILITY_WINDOW_SECONDS = 0.5
SCAN_FEEDBACK_WINDOW_SECONDS = 1.5
GIT_DELAY_SECONDS = 3
TERMINAL_ROWS = 24
TERMINAL_COLUMNS = 100
PROMPT_MARKER = "Select projects"
SCAN_FEEDBACK_MARKER = "Scanning"

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
        package_json = {
            "name": package_name,
            "version": "0.0.0",
            "dependencies": {"react": "18.3.1"},
        }
        if package_name == "app-a":
            package_json["devDependencies"] = {
                "typescript": "5.9.2",
                "vite": "7.1.3",
                "vitest": "3.2.4",
            }
        write_package_json(
            package_directory,
            package_json,
        )
        source_directory = os.path.join(package_directory, "src")
        os.makedirs(source_directory, exist_ok=True)
        with open(os.path.join(source_directory, "index.tsx"), "w", encoding="utf-8") as handle:
            if package_name == "app-a":
                handle.write(
                    'import { useEffect, useState } from "react";\n'
                    'const items = ["first", "second"];\n'
                    "export const Component = () => {\n"
                    "  const [count, setCount] = useState(0);\n"
                    "  useEffect(() => setCount(1), []);\n"
                    "  const Nested = () => <span>{count}</span>;\n"
                    "  return items.map((item, index) => <Nested key={index}>{item}</Nested>);\n"
                    "};\n"
                )
            else:
                handle.write("export const Component = () => null;\n")


def initialize_git_repository(fixture_directory):
    git_binary_path = resolve_git_binary()
    subprocess.run([git_binary_path, "init", "-q", "-b", "main"], cwd=fixture_directory, check=True)
    subprocess.run(
        [git_binary_path, "config", "user.email", "tty-smoke@react.doctor"],
        cwd=fixture_directory,
        check=True,
    )
    subprocess.run(
        [git_binary_path, "config", "user.name", "React Doctor TTY Smoke"],
        cwd=fixture_directory,
        check=True,
    )
    subprocess.run([git_binary_path, "add", "."], cwd=fixture_directory, check=True)
    subprocess.run(
        [git_binary_path, "commit", "-q", "-m", "Initial fixture"],
        cwd=fixture_directory,
        check=True,
    )
    return git_binary_path


def resolve_git_binary():
    git_binary_path = shutil.which("git")
    if git_binary_path is None:
        fail("`git` not found on PATH.")
    return git_binary_path


def create_delayed_git_wrapper(fixture_directory, git_binary_path):
    wrapper_directory = os.path.join(fixture_directory, ".terminal-recording-bin")
    os.makedirs(wrapper_directory, exist_ok=True)
    delay_marker_path = os.path.join(wrapper_directory, "did-delay")
    wrapper_path = os.path.join(wrapper_directory, "git")
    with open(wrapper_path, "w", encoding="utf-8") as handle:
        handle.write(
            "#!/bin/sh\n"
            'for argument in "$@"; do\n'
            '  if [ "$argument" = "diff" ] && '
            f'mkdir "{delay_marker_path}" 2>/dev/null; then\n'
            f"    sleep {GIT_DELAY_SECONDS}\n"
            "    break\n"
            "  fi\n"
            "done\n"
            f'exec "{git_binary_path}" "$@"\n'
        )
    os.chmod(wrapper_path, 0o755)
    return wrapper_directory


def read_pty_until(master_fd, process, captured_output, deadline, marker=None):
    while time.time() < deadline and process.poll() is None:
        readable, _, _ = select.select([master_fd], [], [], 0.05)
        if not readable:
            continue
        try:
            chunk = os.read(master_fd, 4096)
        except OSError:
            chunk = b""
        if chunk:
            captured_output += chunk
            if marker is not None and marker.encode() in captured_output:
                break
    return captured_output


def run_prompt_in_pty(cli_binary_path, fixture_directory, delayed_git_directory):
    child_environment = {
        key: value
        for key, value in os.environ.items()
        if key not in NON_INTERACTIVE_ENVIRONMENT_VARIABLES
    }
    child_environment["FORCE_COLOR"] = "0"
    child_environment["TERM"] = "xterm-256color"
    child_environment["PATH"] = delayed_git_directory + os.pathsep + child_environment["PATH"]

    master_fd, slave_fd = pty.openpty()
    fcntl.ioctl(
        slave_fd,
        termios.TIOCSWINSZ,
        struct.pack("HHHH", TERMINAL_ROWS, TERMINAL_COLUMNS, 0, 0),
    )
    process = subprocess.Popen(
        [NODE_BINARY_PATH, cli_binary_path, fixture_directory, "--no-lint", "--no-dead-code", "--no-score"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        env=child_environment,
        close_fds=True,
    )
    os.close(slave_fd)

    captured_output = read_pty_until(
        master_fd,
        process,
        b"",
        time.time() + STAY_ALIVE_WINDOW_SECONDS,
        PROMPT_MARKER,
    )
    prompt_rendered = PROMPT_MARKER.encode() in captured_output
    if prompt_rendered:
        captured_output = read_pty_until(
            master_fd,
            process,
            captured_output,
            time.time() + PROMPT_STABILITY_WINDOW_SECONDS,
        )
    exited_by_itself = process.poll() is not None
    scan_feedback_rendered = False
    if prompt_rendered and not exited_by_itself:
        os.write(master_fd, b"\r")
        captured_output = read_pty_until(
            master_fd,
            process,
            captured_output,
            time.time() + SCAN_FEEDBACK_WINDOW_SECONDS,
            SCAN_FEEDBACK_MARKER,
        )
        scan_feedback_rendered = SCAN_FEEDBACK_MARKER.encode() in captured_output

    if process.poll() is None:
        process.send_signal(signal.SIGKILL)
        process.wait()
    os.close(master_fd)

    return exited_by_itself, scan_feedback_rendered, captured_output.decode("utf-8", "replace")


def main():
    parser = argparse.ArgumentParser()
    preparation_mode = parser.add_mutually_exclusive_group()
    preparation_mode.add_argument("--prepare-fixture")
    preparation_mode.add_argument("--prepare-git-wrapper")
    parser.add_argument("--cli-binary", default=DEFAULT_CLI_BINARY_PATH)
    arguments = parser.parse_args()
    if arguments.prepare_fixture:
        fixture_directory = os.path.abspath(arguments.prepare_fixture)
        create_workspace_fixture(fixture_directory)
        git_binary_path = initialize_git_repository(fixture_directory)
        create_delayed_git_wrapper(fixture_directory, git_binary_path)
        return
    if arguments.prepare_git_wrapper:
        fixture_directory = os.path.abspath(arguments.prepare_git_wrapper)
        create_delayed_git_wrapper(fixture_directory, resolve_git_binary())
        return

    cli_binary_path = os.path.abspath(arguments.cli_binary)
    if not os.path.isfile(cli_binary_path):
        fail(f"Built CLI missing at {cli_binary_path}. Run `pnpm build` first.")

    fixture_directory = tempfile.mkdtemp(prefix="react-doctor-tty-smoke-")
    try:
        create_workspace_fixture(fixture_directory)
        git_binary_path = initialize_git_repository(fixture_directory)
        delayed_git_directory = create_delayed_git_wrapper(fixture_directory, git_binary_path)
        exited_by_itself, scan_feedback_rendered, output = run_prompt_in_pty(
            cli_binary_path,
            fixture_directory,
            delayed_git_directory,
        )
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

    if not scan_feedback_rendered:
        print(output[:1000], file=sys.stderr)
        fail(
            f'The "{SCAN_FEEDBACK_MARKER}" indicator did not render within '
            f"{SCAN_FEEDBACK_WINDOW_SECONDS}s after project selection while git was still busy."
        )

    print(
        f'Smoke OK: "{PROMPT_MARKER}" prompt rendered in a real PTY and the '
        f'process stayed alive waiting for input; "{SCAN_FEEDBACK_MARKER}" then '
        "rendered before the delayed git lookup completed."
    )


if __name__ == "__main__":
    main()
