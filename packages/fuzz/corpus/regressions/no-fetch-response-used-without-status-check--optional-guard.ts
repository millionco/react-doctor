export const load = async () => {
  const response = await fetch("/data");
  if (!response?.ok) return null;
  return response.json();
};
