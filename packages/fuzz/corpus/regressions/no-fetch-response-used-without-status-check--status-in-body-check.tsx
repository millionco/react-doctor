// rule: no-fetch-response-used-without-status-check
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (task verification: the status lives in the parsed body and is checked before any success read)
export async function verifyTask(props: object) {
  const res = await fetch("/tasks_verification", {
    method: "POST",
    body: JSON.stringify(props),
  });
  const jsonResponse = await res.json();
  if (jsonResponse.status !== 201 && jsonResponse.statusCode !== 201) {
    throw new Error(jsonResponse.message);
  }
  return jsonResponse;
}
