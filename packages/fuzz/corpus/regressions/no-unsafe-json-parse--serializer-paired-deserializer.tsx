// rule: no-unsafe-json-parse
// weakness: library-idiom
// source: react-bench corpus audit 2026-07 (audius key pair: the deserializer's only input is the same-module stringify serializer's output)
import { decode, encode } from "./base64";

export const serializeKeyPair = (value: { publicKey: Uint8Array; secretKey: Uint8Array }) => {
  const { publicKey, secretKey } = value;
  return JSON.stringify({ publicKey: encode(publicKey), secretKey: encode(secretKey) });
};

export const deserializeKeyPair = (value: string) => {
  const { publicKey, secretKey } = JSON.parse(value);
  return { publicKey: decode(publicKey), secretKey: decode(secretKey) };
};
