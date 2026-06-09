# Reproduces this task's environment (fallback if the prebuilt image is absent).
# FROM the shared SlopBench base, which already provides react-doctor +
# slop-verify + the slopbench-grade script.
FROM slopbench-base:latest

WORKDIR /app

# TODO: bring in the seed repo at the task's base commit. Either clone an
# external repo:
#   RUN git clone <repository_url> . \
#     && git checkout <base_commit_hash> \
#     && pnpm install --frozen-lockfile --ignore-scripts
# or COPY an in-tree seed (see tasks that ship a `seed/` directory) and init git:
#   COPY seed/ .
#   RUN git init -q && git add -A && git -c user.email=t@t.co -c user.name=t commit -qm base \
#     && pnpm install --ignore-scripts

CMD ["/bin/bash"]
