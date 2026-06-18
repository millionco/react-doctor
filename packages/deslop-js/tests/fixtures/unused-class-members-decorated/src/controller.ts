import { Get, Internal } from "./decorators.js";

class UserController {
  @Get("/users")
  public listUsers(): string {
    return "all users";
  }

  @Get("/users/me")
  public currentUser(): string {
    return "me";
  }

  @Internal()
  public deadInternal(): string {
    return "Internal decorator NOT in allowlist — should still flag";
  }

  public deadPlainMethod(): string {
    return "no decorator, no usage — should flag";
  }
}

export const userController = new UserController();
