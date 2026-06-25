import type { Post } from "./post";

export interface User {
  name: string;
  posts: Post[];
}

export const createUser = (name: string): User => ({ name, posts: [] });
