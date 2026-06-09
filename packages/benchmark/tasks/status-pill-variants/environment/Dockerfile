FROM slopbench-base:latest

WORKDIR /app

COPY seed/ .
RUN pnpm install --frozen-lockfile --ignore-scripts || pnpm install --ignore-scripts
RUN git init -q \
  && git add -A \
  && git -c user.email=bench@react.doctor -c user.name=slopbench commit -qm "base" \
  && git config --global --add safe.directory /app

CMD ["/bin/bash"]
