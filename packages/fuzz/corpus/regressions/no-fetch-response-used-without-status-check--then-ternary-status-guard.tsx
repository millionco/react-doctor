// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: PR #1402 Daytona parity audit (RGJorge/ContainerFlow useDocker)
export const loadDockerState = () =>
  fetch("/api/init")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => data?.services ?? []);
