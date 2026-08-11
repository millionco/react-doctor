import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findStronglyConnectedComponents } from "../src/utils/find-strongly-connected-components.js";

describe("findStronglyConnectedComponents", () => {
  it("preserves depth-first component and node emission order", () => {
    const adjacencyList = [[1], [2, 3], [0], [4], [3], [], [6]];

    assert.deepEqual(findStronglyConnectedComponents(adjacencyList), [[4, 3], [2, 1, 0], [5], [6]]);
  });
});
