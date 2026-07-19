// rule: no-fetch-response-used-without-status-check
// weakness: library-idiom
export const load = async (api: { createObjectURL(): string }) => {
  const response = await fetch(api.createObjectURL());
  return response.json();
};
