import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { insecureCryptoRisk } from "./insecure-crypto-risk.js";

describe("security-scan/insecure-crypto-risk — regressions", () => {
  it("stays silent on the French word 'des' in locale strings", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/locales/fr/accessibility.ts",
      content: `export const accessibility = {\n  open_favorites_menu: "Ouvrir le menu des favoris",\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on md5 used for non-security file fingerprinting", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/build/fingerprint.ts",
      content: `import { createHash } from "node:crypto";\n\nexport const fingerprintFile = (fileContents: Buffer) =>\n  createHash("md5").update(fileContents).digest("hex");\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on signature comparison in a file that uses timingSafeEqual", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/server/webhook.ts",
      content: `const isValid = crypto.timingSafeEqual(expected, received);\nif (signatureHeader !== undefined && isValid) process(payload);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on Math.random retry jitter in a file that mentions tokens elsewhere", () => {
    const tokenMention = "const accessToken = await refreshAccessToken(credential);";
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/services/calendar-service.ts",
      content: `${tokenMention}\n${"// padding\n".repeat(40)}const jitterSeconds = Number(Math.random().toFixed(3));\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags md5 hashing of password material", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/server/auth.ts",
      content: `import { createHash } from "node:crypto";\n\nexport const hashPassword = (password: string) =>\n  createHash("md5").update(password).digest("hex");\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a weak cipher algorithm passed to createCipheriv", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/server/encrypt.ts",
      content: `const cipher = crypto.createCipheriv("des-ede3", key, iv);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on Gravatar md5 hashes", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/graphics/account/gravatar.tsx",
      content: `import { useAuth } from "../providers/Auth";\n\nexport const GravatarAccountIcon = () => {\n  const { user } = useAuth();\n  const hash = md5(user.email.trim().toLowerCase());\n  return <img src={\`https://www.gravatar.com/avatar/\${hash}\`} alt="" />;\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on signature comparisons against enum members", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/types/plugin-signature.ts",
      content: `export function isUnsignedPluginSignature(signature?: PluginSignatureStatus) {\n  return signature && signature !== PluginSignatureStatus.valid && signature !== PluginSignatureStatus.internal;\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on Math.random jitter near unrelated token loops", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/streams/simulate.ts",
      content: `for (const token of initialTokens) {\n  await setTimeout(Math.random() * 10 + 5);\n  yield token;\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags Math.random feeding a token on the same statement", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/session-token.ts",
      content: `export const sessionToken = () => Math.random().toString(36).slice(2);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on vendored version-pinned libraries", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "public/libraries/jsonwebtoken@8.5.1.js",
      content: `const cipherTable = { "des-cbc": CBC.instantiate(DES), "des-ecb": DES };\nconst cipher = crypto.createCipheriv("des-ede3", key, iv);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on vendored version-pinned directories", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "public/js/monaco-editor.0.45.0/vs/editor/editor.main.js",
      content: `const sessionTokenHash = md5(value);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on node-forge's namespaced createCipher", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/account/crypt.ts",
      content: `const cipher = forge.cipher.createCipher('AES-GCM', key);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags node:crypto's deprecated createCipher", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/account/crypt.ts",
      content: `const cipher = crypto.createCipher('aes-256-cbc', password);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on signature-method comparisons against module constants", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/network/o-auth-1/get-token.ts",
      content: `if (authentication.signatureMethod === SIGNATURE_METHOD_RSA_SHA1) {\n  return signRsaSha1(payload);\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on protocol-mandated md5 in HTTP digest auth", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/lib/axios/digest-auth.ts",
      content: `const ha1 = crypto.hashing().md5(\`\${username}:\${realm}:\${password}\`, DigestType.Hex);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on sha1-derived deterministic ids", () => {
    const findings = runScanRule(insecureCryptoRisk, {
      relativePath: "src/services/cookie-jar.ts",
      content: `const jar = {\n  _id: \`\${prefix}_\${crypto.createHash('sha1').update(parentId).digest('hex')}\`,\n  cookies: cookieJar.cookies,\n};\n`,
    });
    expect(findings).toHaveLength(0);
  });
});
