FROM slopbench-base:latest

WORKDIR /app

COPY seed/ .
# Pure-TS task: no dependency install (functional test uses node --test).
RUN git init -q \
  && git add -A \
  && git -c user.email=bench@react.doctor -c user.name=slopbench commit -qm "base" \
  && git config --global --add safe.directory /app

CMD ["/bin/bash"]
