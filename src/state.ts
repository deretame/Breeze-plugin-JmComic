import type { CacheApi } from "../type/runtime-globals";
import { getApi } from "../type/runtime-api";
import { Config } from "./constants";
import type { CacheKeyConfig } from "./types";
import { randomDeviceId } from "./utils";

let fallbackDeviceId = "";
let fallbackJwt = "";
let fallbackUa = "";
const inMemoryCache = new Map<string, unknown>();

function getCache(): CacheApi | null {
  return getApi("cache") ?? null;
}

function cacheGet<T>(key: string, fallback: T): T {
  const c = getCache();
  if (c) {
    try {
      return c.get<T>(key, fallback);
    } catch {}
  }

  if (inMemoryCache.has(key)) {
    return inMemoryCache.get(key) as T;
  }
  return fallback;
}

function cacheSet(key: string, value: unknown): void {
  const c = getCache();
  if (c) {
    try {
      c.set(key, value);
    } catch {}
  }
  inMemoryCache.set(key, value);
}

function cacheDelete(key: string): void {
  const c = getCache();
  if (c) {
    try {
      c.delete(key);
    } catch {}
  }
  inMemoryCache.delete(key);
}

function scopedKey(key: string): string {
  const raw = String(key || "").trim();
  return `${Config.JM_CACHE_SCOPE}::${raw}`;
}

function getCachedString(key: string): string {
  return String(cacheGet<string>(scopedKey(key), "") || "").trim();
}

function setCachedString(key: string, value: string): void {
  cacheSet(scopedKey(key), value);
}

export function getDeviceId(): string {
  const cached = getCachedString("device");
  if (cached) {
    fallbackDeviceId = cached;
    return cached;
  }

  if (!fallbackDeviceId) {
    fallbackDeviceId = randomDeviceId();
  }
  setCachedString("device", fallbackDeviceId);
  return fallbackDeviceId;
}

export function getJwtToken(): string {
  const cached = getCachedString("jwt");
  if (cached) {
    fallbackJwt = cached;
    return cached;
  }
  return fallbackJwt;
}

export function setJwtToken(token: string): void {
  const normalized = String(token || "").trim();
  fallbackJwt = normalized;
  setCachedString("jwt", normalized);
}

function generateAndroidUserAgent(deviceId: string): string {
  const androidVersions = ["10", "11", "12", "13", "14", "15"];
  const chromeVersions = [
    "114.0.5735.196",
    "116.0.5845.172",
    "118.0.5993.111",
    "119.0.6045.194",
    "120.0.6099.230",
    "121.0.6167.178",
    "122.0.6261.119",
    "123.0.6312.118",
    "124.0.6367.179",
    "125.0.6422.165",
  ];
  const buildCodes = [
    "TQ1A.230305.002",
    "UP1A.231005.007",
    "UQ1A.240205.002",
    "AP1A.240405.002",
  ];

  const android =
    androidVersions[Math.floor(Math.random() * androidVersions.length)] || "13";
  const chrome =
    chromeVersions[Math.floor(Math.random() * chromeVersions.length)] ||
    "120.0.6099.230";
  const build =
    buildCodes[Math.floor(Math.random() * buildCodes.length)] ||
    "TQ1A.230305.002";

  return `Mozilla/5.0 (Linux; Android ${android}; ${deviceId} Build/${build}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome} Mobile Safari/537.36`;
}

export function getUserAgent(): string {
  if (fallbackUa) return fallbackUa;

  const cached = getCachedString("ua");
  if (cached) {
    fallbackUa = cached;
    return cached;
  }

  const ua = generateAndroidUserAgent(getDeviceId());
  fallbackUa = ua;
  setCachedString("ua", ua);
  return ua;
}

export function cacheKeyFromConfig(config: CacheKeyConfig): string {
  const q = config.params ? JSON.stringify(config.params) : "";
  const body =
    config.data === undefined || config.data === null
      ? ""
      : String(config.data);
  return `${config.method}|${config.url}|${q}|${body}`;
}

export function getCachedResponse(config: CacheKeyConfig): unknown | null {
  const key = cacheKeyFromConfig(config);
  const storeKey = scopedKey(`resp:${key}`);
  const raw = cacheGet<{ expireAt?: number; value?: unknown } | null>(
    storeKey,
    null,
  );
  if (!raw || typeof raw !== "object") return null;

  const expireAt = Number(raw.expireAt || 0);
  if (!Number.isFinite(expireAt) || Date.now() > expireAt) {
    cacheDelete(storeKey);
    return null;
  }

  return raw.value ?? null;
}

export function setCachedResponse(
  config: CacheKeyConfig,
  value: unknown,
): void {
  const key = cacheKeyFromConfig(config);
  try {
    cacheSet(scopedKey(`resp:${key}`), {
      expireAt: Date.now() + 10 * 60 * 1000,
      value,
    });
  } catch (err) {
    console.error("setCachedResponse failed", err);
  }
}
