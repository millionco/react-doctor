import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDashboard } from "../src/load-dashboard.ts";

test("combines the three sources into one object", async () => {
  const data = await loadDashboard({
    fetchUser: async () => "Ada",
    fetchStats: async () => 42,
    fetchActivity: async () => ["login", "edit"],
  });
  assert.deepEqual(data, { user: "Ada", stats: 42, activity: ["login", "edit"] });
});

test("resolves every source value", async () => {
  const data = await loadDashboard({
    fetchUser: async () => "Grace",
    fetchStats: async () => 0,
    fetchActivity: async () => [],
  });
  assert.equal(data.user, "Grace");
  assert.equal(data.stats, 0);
  assert.deepEqual(data.activity, []);
});
