import {
  AUTH_ASSERTIVE_VERB_TOKENS,
  AUTH_GETTER_VERB_TOKENS,
  AUTH_QUALIFIER_TOKENS,
  AUTH_STANDALONE_NOUN_TOKENS,
  AUTH_STRONG_NOUN_TOKENS,
  AUTH_STRONG_TOKEN_PATTERN,
  AUTH_WEAK_NOUN_TOKENS,
} from "../constants/security.js";
import { tokenizeIdentifierWords } from "./tokenize-identifier-words.js";

const SIGNED_IN_HEAD_TOKENS = new Set(["signed", "logged", "sign"]);

// Collapse `signedIn` / `loggedIn` / `signIn` — tokenized as two words — into
// a single standalone auth phrase so the matcher reads them as one signal.
const mergeSignedInTokens = (tokens: string[]): string[] => {
  const mergedTokens: string[] = [];
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const currentToken = tokens[tokenIndex];
    if (SIGNED_IN_HEAD_TOKENS.has(currentToken) && tokens[tokenIndex + 1] === "in") {
      mergedTokens.push(`${currentToken}in`);
      tokenIndex += 1;
      continue;
    }
    mergedTokens.push(currentToken);
  }
  return mergedTokens;
};

// Recognizes auth-guard call names by naming CONVENTION rather than an exact
// allowlist, so custom guards (`requireAdmin`, `getAdminSession`,
// `ensureSignedIn`, `hasRole`) count as an auth check the same way `auth()`
// or `getServerSession()` do. Deliberately leaves genuinely ambiguous names
// (`getUser`, `getToken`) unmatched — those stay on the rule's exact-name +
// auth-receiver path so `analytics.getUser()` is not mistaken for auth.
export const isAuthGuardName = (calleeName: string): boolean => {
  const tokens = mergeSignedInTokens(tokenizeIdentifierWords(calleeName));
  if (tokens.length === 0) return false;

  let hasAssertiveVerb = false;
  let hasGetterVerb = false;
  let hasQualifier = false;
  let hasStrongNoun = false;
  let hasWeakNoun = false;

  for (const token of tokens) {
    if (AUTH_STRONG_TOKEN_PATTERN.test(token) || AUTH_STANDALONE_NOUN_TOKENS.has(token)) {
      return true;
    }
    if (AUTH_ASSERTIVE_VERB_TOKENS.has(token)) hasAssertiveVerb = true;
    if (AUTH_GETTER_VERB_TOKENS.has(token)) hasGetterVerb = true;
    if (AUTH_QUALIFIER_TOKENS.has(token)) hasQualifier = true;
    if (AUTH_STRONG_NOUN_TOKENS.has(token)) hasStrongNoun = true;
    if (AUTH_WEAK_NOUN_TOKENS.has(token)) hasWeakNoun = true;
  }

  if (hasAssertiveVerb && (hasStrongNoun || hasWeakNoun)) return true;
  if (hasGetterVerb && hasStrongNoun) return true;
  if (hasQualifier && hasWeakNoun) return true;
  return false;
};
