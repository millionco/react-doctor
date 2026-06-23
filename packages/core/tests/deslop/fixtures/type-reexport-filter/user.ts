import type { User } from "./types";

export const createUser = (name: string): User => ({
  id: Math.random().toString(),
  name,
  role: "viewer",
});

export const deleteUser = (id: string) => {
  console.log("deleted", id);
};
