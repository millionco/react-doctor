import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reactCompilerDestructureMethod } from "./react-compiler-destructure-method.js";

const run = (code: string) =>
  runRule(reactCompilerDestructureMethod, code, { filename: "fixture.tsx" });

describe("architecture/react-compiler-destructure-method — regressions", () => {
  it("does not flag useSearchParams().get() — its methods need their `this` receiver", () => {
    const result = run(
      `import { useSearchParams } from "next/navigation";
       function Page() { const searchParams = useSearchParams(); const q = searchParams.get("q"); return <div>{q}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags useRouter().push() (a bound function property)", () => {
    const result = run(
      `function Page() { const router = useRouter(); return <button onClick={() => router.push("/x")}>go</button>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags useNavigation().navigate() (a bound function property)", () => {
    const result = run(
      `function Screen() { const navigation = useNavigation(); return <button onClick={() => navigation.navigate("Home")}>go</button>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
