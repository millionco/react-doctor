import { describe, expect, it } from "vite-plus/test";
import { isAuthGuardName } from "./is-auth-guard-name.js";

describe("isAuthGuardName", () => {
  it.each([
    // auth* token in any position
    "auth",
    "authN",
    "authZ",
    "authed",
    "authenticate",
    "authenticated",
    "authentication",
    "authorize",
    "authorized",
    "authorization",
    "requireAuth",
    "checkAuth",
    "verifyAuth",
    "getAuth",
    "withAuth",
    "isAuthenticated",
    "ensureAuthenticated",
    "getServerAuthSession",
    // assertive verb + auth noun (the issue #829 shape)
    "requireAdmin",
    "requireUser",
    "requireSession",
    "ensureAdmin",
    "assertUser",
    "checkPermission",
    "verifyToken",
    "validateSession",
    "enforceRole",
    "restrictAccess",
    "isAdmin",
    "hasRole",
    "hasPermission",
    "mustBeAdmin",
    // getter verb + strong auth noun
    "getSession",
    "getServerSession",
    "getAdminSession",
    "fetchSession",
    "useSession",
    "loadSession",
    "verifyJWT",
    // "whose" qualifier + weak noun
    "currentUser",
    "getCurrentUser",
    "myAccount",
    // merged signed-in / logged-in phrases
    "isSignedIn",
    "isLoggedIn",
    "ensureSignedIn",
    "requireLoggedIn",
    "signedInUser",
  ])("treats %s as an auth guard", (name) => {
    expect(isAuthGuardName(name)).toBe(true);
  });

  it.each([
    // ambiguous getters that must stay on the exact-name + receiver path
    "getUser",
    "getToken",
    "getAccount",
    "getUsername",
    "fetchUser",
    "useUser",
    // auth-looking substrings that are NOT auth words
    "getAuthor",
    "createAuthor",
    "tokenize",
    "authority",
    // domain guards that intentionally require opt-in config (member/workspace
    // are not auth nouns; see the requireWorkspaceMember regression test)
    "requireWorkspaceMember",
    "ensureWorkspace",
    "requireTeam",
    // plain non-auth calls
    "performDelete",
    "info",
    "update",
    "deletePost",
    "trackVisit",
    "createSession",
    "deleteSession",
    "",
  ])("does not treat %s as an auth guard", (name) => {
    expect(isAuthGuardName(name)).toBe(false);
  });
});
