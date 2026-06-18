export interface User {
  id: string;
  name: string;
  role: UserRole;
}

export type UserRole = "admin" | "editor" | "viewer";

export interface UnusedConfig {
  debug: boolean;
}
