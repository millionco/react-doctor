FROM slopbench-base:latest

WORKDIR /app

# In-tree seed committed as the base commit. No dependency install needed —
# the functional test uses Node's built-in test runner with type stripping.
COPY seed/ .
RUN git init -q \
  && git add -A \
  && git -c user.email=bench@react.doctor -c user.name=slopbench commit -qm "base" \
  && git config --global --add safe.directory /app

CMD ["/bin/bash"]
