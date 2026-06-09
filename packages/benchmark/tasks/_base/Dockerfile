# SlopBench shared base image.
#
# Built once (internet IS allowed at image-build time); every task's
# environment/Dockerfile does `FROM slopbench-base`. The agent run itself stays
# air-gapped (`allow_internet = false` in task.toml) — both the React Doctor
# scan and the slop verifier run fully offline, so nothing here needs the
# network at grade time.
#
# It installs two pinned CLIs onto PATH:
#   react-doctor  — the offline diagnostic engine the verifier shells out to
#   slop-verify   — the SlopBench verifier (this repo's @react-doctor/benchmark)
# plus the shared grader `slopbench-grade` every task's test.sh execs.
#
# Both CLIs come from a single pinned checkout of the react-doctor monorepo so
# scoring is reproducible. Pin REACT_DOCTOR_REF to a tag or full SHA — never a
# moving branch — when cutting a benchmark release.
FROM node:22-bookworm-slim

# Pin to an immutable ref for reproducible scores. Override at build:
#   docker build --build-arg REACT_DOCTOR_REF=<sha> ...
ARG REACT_DOCTOR_REF=react-doctor@0.4.2
ARG REACT_DOCTOR_REPO=https://github.com/millionco/react-doctor

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Build react-doctor + the slop verifier from a single pinned checkout.
RUN git clone "${REACT_DOCTOR_REPO}" /opt/react-doctor \
  && cd /opt/react-doctor \
  && git checkout "${REACT_DOCTOR_REF}" \
  && pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm --filter react-doctor --filter @react-doctor/benchmark run build

# Expose both CLIs by their bin names. The bin scripts resolve their own
# dist/* and node_modules relative to the real (symlink-resolved) path.
RUN ln -s /opt/react-doctor/packages/react-doctor/bin/react-doctor.js /usr/local/bin/react-doctor \
  && ln -s /opt/react-doctor/packages/benchmark/bin/slop-verify.js /usr/local/bin/slop-verify \
  && chmod +x /opt/react-doctor/packages/benchmark/bin/slop-verify.js

# The shared grader every task's tests/test.sh execs. Lives in the image so the
# per-task test.sh stays a thin, Harbor-friendly wrapper (no shared files needed
# in the /tests context).
RUN cp /opt/react-doctor/packages/benchmark/tasks/_base/run-verifier.sh /usr/local/bin/slopbench-grade \
  && chmod +x /usr/local/bin/slopbench-grade

# Sanity-check the CLIs are runnable.
RUN slop-verify --help >/dev/null

WORKDIR /app
CMD ["/bin/bash"]
