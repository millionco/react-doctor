import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { rawSqlInjectionRisk } from "./raw-sql-injection-risk.js";

describe("security-scan/raw-sql-injection-risk — regressions", () => {
  it("stays silent on Prisma.raw with a pure string literal", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/filter-to-prisma.ts",
      content: `return Prisma.join([Prisma.raw("AND "), sql], "");\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on whereRaw with driver-side parameter binding", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/services/sessions.ts",
      content: `builder\n  .whereRaw("e.session_id = {sessionId: String}", { sessionId: props.sessionId })\n  .whereRaw("e.is_deleted = 0");\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when query interpolations are wrapped in a sanitizer", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/crm/service.ts",
      content:
        "const result = await conn.query(`SELECT Id FROM User WHERE Email = '${this.sanitizeSoqlValue(email)}' LIMIT 1`);\n",
    });
    expect(findings).toHaveLength(0);
  });

  it("flags queryRawUnsafe escape hatches", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/raw-sql.ts",
      content:
        "export const q = (prisma, id) => prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("flags Prisma.raw built from interpolation", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/order-by.ts",
      content: "return Prisma.raw(`ORDER BY ${column} ${direction}`);\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("flags whereRaw built from interpolation", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/query.ts",
      content: "builder.whereRaw(`tenant_id = '${tenantId}'`);\n",
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on parameterized whereRaw whose literal starts on the next line", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/repositories/events.ts",
      content:
        'queryBuilder.whereRaw(\n  "e.span_id IN (SELECT span_id FROM qualifying_obs WHERE _rn = {_posRn: UInt32})",\n  { _posRn: Math.max(1, position) },\n);\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when concat output is wrapped in connection.escape()", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM users WHERE id = " + connection.escape(id));\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when concat output is wrapped in connection.escapeId()", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM t ORDER BY " + connection.escapeId(col));\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when concat output is wrapped in SqlString.escape()", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'pool.query("SELECT * FROM t WHERE name = " + SqlString.escape(name));\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("flags concat with raw req.body input", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM users WHERE id = " + req.body.id);\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("flags concat with a bare variable", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM users WHERE id = " + userId);\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("flags concat wrapped in escapeHtml (HTML escaping is not SQL-safe)", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM users WHERE name = " + utils.escapeHtml(v));\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a raw tainted operand after an escaped first operand", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content:
        'connection.query("SELECT * FROM users WHERE id = " + connection.escape(id) + " AND role = " + req.body.role);\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("flags concat wrapped in lodash _.escape (HTML escape, not SQL-safe)", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content:
        'connection.query("SELECT * FROM users WHERE name = \'" + _.escape(req.query.name) + "\'");\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("flags concat wrapped in validator.escape (HTML escape, not SQL-safe)", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content:
        'connection.query("SELECT * FROM users WHERE name = \'" + validator.escape(req.query.name) + "\'");\n',
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when concat output is wrapped in client.escapeLiteral()", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'client.query("SELECT * FROM users WHERE name = " + client.escapeLiteral(name));\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when concat output is wrapped in client.escapeIdentifier()", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'client.query("SELECT * FROM t ORDER BY " + client.escapeIdentifier(col));\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent with a newline between + and the escaper (multi-line concat)", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content:
        'connection.query(\n  "SELECT * FROM users WHERE id = " +\n    connection.escape(id)\n);\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when the escaped operand is parenthesized", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM users WHERE id = " + (connection.escape(id)));\n',
    });
    expect(findings).toHaveLength(0);
  });

  it("flags escape used as a property access (not a call)", () => {
    const findings = runScanRule(rawSqlInjectionRisk, {
      relativePath: "src/server/users.ts",
      content: 'connection.query("SELECT * FROM users WHERE id = " + obj.escape);\n',
    });
    expect(findings).toHaveLength(1);
  });
});
