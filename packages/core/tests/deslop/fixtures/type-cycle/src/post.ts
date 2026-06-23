import type { User } from "./user";

export interface Post {
  title: string;
  author: User;
}

export const createPost = (title: string): Post => ({
  title,
  author: { name: "unknown", posts: [] },
});
