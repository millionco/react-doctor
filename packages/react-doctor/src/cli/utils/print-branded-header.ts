import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";
import { VERSION } from "./version.js";

/**
 * Single branded line every command prints first when not in JSON
 * / score mode. Keeps the visual signature consistent across
 * `inspect`, `install`, and any future subcommand.
 *
 * Effect-typed: callers either `yield*` from inside `Effect.gen`
 * (the canonical path) or bridge with `Effect.runSync(...)` when
 * they're still inside an imperative function.
 */
export const printBrandedHeader: Effect.Effect<void> = Effect.gen(function* () {
  yield* Console.log(`${highlighter.bold("react-doctor")} ${highlighter.dim(`v${VERSION}`)}`);
  yield* Console.log("");
});
