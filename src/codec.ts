import { runtime } from "../types/runtime-api";
import { Config } from "./constants";
import { hostAesEcbPkcs7DecryptB64 } from "./host-bridge";
import { md5Hex } from "./utils";

const BASE64_BODY_RE = /^[A-Za-z0-9+/]*$/;

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function maybeGunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    try {
      return await runtime.bridge.gzipDecompress(bytes);
    } catch {
      return bytes;
    }
  }
  return bytes;
}

function bytesToUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function normalizeBase64(raw: string): string | null {
  const compact = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!compact) {
    return null;
  }

  const body = compact.replace(/=+$/g, "");
  if (!body || !BASE64_BODY_RE.test(body)) {
    return null;
  }

  const mod = body.length % 4;
  if (mod === 1) {
    return null;
  }
  if (mod === 0) {
    return body;
  }

  return `${body}${"=".repeat(4 - mod)}`;
}

async function decryptDataField(
  payload: string,
  ts: string,
): Promise<unknown | null> {
  const tsRaw = String(ts || "").trim();
  if (!tsRaw) {
    return null;
  }

  try {
    const key = await md5Hex(`${tsRaw}${Config.JM_SECRET}`);
    const text = await hostAesEcbPkcs7DecryptB64(payload, key);
    if (!text.trim()) {
      return null;
    }
    return tryParseJson(text.trim()) ?? text;
  } catch {
    return null;
  }
}

async function normalizeRawResponse(raw: unknown): Promise<unknown> {
  if (raw === null || raw === undefined || typeof raw === "string") {
    return raw;
  }

  if (raw instanceof ArrayBuffer) {
    return bytesToUtf8(await maybeGunzipBytes(new Uint8Array(raw)));
  }

  if (ArrayBuffer.isView(raw)) {
    return bytesToUtf8(
      await maybeGunzipBytes(
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      ),
    );
  }

  return raw;
}

async function decodeValue(value: unknown, ts: string): Promise<unknown> {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) {
      return "";
    }
    const parsed = tryParseJson(raw);
    if (parsed !== null) {
      return decodeValue(parsed, ts);
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const obj = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        String(k),
        v,
      ]),
    );
    const dataField = obj.data;
    if (typeof dataField === "string" && dataField.trim()) {
      const rawData = dataField.trim();
      const normalizedB64 = normalizeBase64(rawData);
      if (normalizedB64) {
        const decrypted = await decryptDataField(normalizedB64, ts);
        if (decrypted !== null) {
          return decrypted;
        }
      }

      const parsed = tryParseJson(rawData);
      if (parsed !== null) {
        return parsed;
      }
    }
    return obj;
  }

  return value;
}

export async function decodeResponsePayload(
  raw: unknown,
  ts: string,
): Promise<unknown> {
  return decodeValue(await normalizeRawResponse(raw), ts);
}
