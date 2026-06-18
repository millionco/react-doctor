import { hello } from "../index";
test("hello", () => expect(hello()).toBe("world"));
