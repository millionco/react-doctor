export const createUser = (input: { id: string; name: string; email: string }): void => {
  console.log(input);
};

export const updateUser = (patch: { id: string; name: string; email: string }): void => {
  console.log(patch);
};

export function fetchProfile(): { id: string; name: string; email: string } {
  return { id: "1", name: "Ada", email: "ada@example.com" };
}

export const buildProfile = (): { id: string; name: string; email: string } => ({
  id: "1",
  name: "Ada",
  email: "ada@example.com",
});

export const localAlias = (): string => {
  type ProfileLocal = { id: string; name: string; email: string };
  const profile: ProfileLocal = { id: "1", name: "Ada", email: "ada@example.com" };
  return profile.name;
};

export const uniqueShape = (input: { onlyHere: true }): void => {
  console.log(input);
};

export const twoPropShape = (input: { a: number; b: number }): void => {
  console.log(input);
};

export const twoPropShape2 = (input: { a: number; b: number }): void => {
  console.log(input);
};
