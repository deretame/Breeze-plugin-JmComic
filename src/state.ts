import { cache } from "breeze-plugin-kit";
import { Config } from "./constants";
import type { CacheKeyConfig } from "./types";
import { randomDeviceId } from "./utils";

let fallbackDeviceId = "";
let fallbackJwt = "";
let fallbackUa = "";

export type RuntimeEndpointCache = {
  apiBaseUrl: string;
  imageBaseUrl: string;
  /** 测速排序后的图床池, 首选第一条. 旧缓存缺该字段时回退 [imageBaseUrl]. */
  imagePool: string[];
  hostPool: string[];
  updatedAt: number;
};
const ENDPOINT_CACHE_TTL_MS = 30 * 60 * 1000;

async function cacheSet(key: string, value: unknown) {
  await cache.set(key, value);
}

async function cacheDelete(key: string) {
  await cache.delete(key);
}

function scopedKey(key: string): string {
  const raw = String(key || "").trim();
  return `${Config.JM_CACHE_SCOPE}::${raw}`;
}

async function getCachedString(key: string) {
  return String(await cache.get(scopedKey(key))).trim();
}

async function setCachedString(key: string, value: string) {
  await cacheSet(scopedKey(key), value);
}

export async function getDeviceId() {
  const cached = await getCachedString("device");
  if (cached) {
    fallbackDeviceId = cached;
    return cached;
  }

  if (!fallbackDeviceId) {
    fallbackDeviceId = randomDeviceId();
  }
  await setCachedString("device", fallbackDeviceId);
  return fallbackDeviceId;
}

export async function getJwtToken() {
  const cached = await getCachedString("jwt");
  if (cached) {
    fallbackJwt = cached;
    return cached;
  }
  return fallbackJwt;
}

export async function setJwtToken(token: string) {
  const normalized = String(token || "").trim();
  fallbackJwt = normalized;
  await setCachedString("jwt", normalized);
}

function generateAndroidUserAgent(deviceId: string) {
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

export async function getUserAgent() {
  if (fallbackUa) return fallbackUa;

  const cached = await getCachedString("ua");
  if (cached) {
    fallbackUa = cached;
    return cached;
  }

  const ua = generateAndroidUserAgent(await getDeviceId());
  fallbackUa = ua;
  await setCachedString("ua", ua);
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

export async function getCachedResponse(config: CacheKeyConfig) {
  const key = cacheKeyFromConfig(config);
  const storeKey = scopedKey(`resp:${key}`);
  const raw = (await cache.get(storeKey, null)) as {
    expireAt?: number;
    value?: unknown;
  } | null;

  if (!raw || typeof raw !== "object") return null;

  const expireAt = Number(raw.expireAt || 0);
  if (!Number.isFinite(expireAt) || Date.now() > expireAt) {
    await cacheDelete(storeKey);
    return null;
  }

  return raw.value ?? null;
}

export async function setCachedResponse(
  config: CacheKeyConfig,
  value: unknown,
) {
  const key = cacheKeyFromConfig(config);
  try {
    await cacheSet(scopedKey(`resp:${key}`), {
      expireAt: Date.now() + 10 * 60 * 1000,
      value,
    });
  } catch (err) {
    console.error("setCachedResponse failed", err);
  }
}

export async function getRuntimeEndpointCache(
  ttlMs = ENDPOINT_CACHE_TTL_MS,
): Promise<RuntimeEndpointCache | null> {
  const raw = (await cache.get(
    scopedKey("runtime:endpoints"),
    null,
  )) as RuntimeEndpointCache | null;
  if (!raw || typeof raw !== "object") return null;

  const apiBaseUrl = String(raw.apiBaseUrl || "").trim();
  const imageBaseUrl = String(raw.imageBaseUrl || "").trim();
  const imagePool = Array.isArray(raw.imagePool)
    ? raw.imagePool.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const hostPool = Array.isArray(raw.hostPool)
    ? raw.hostPool.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const updatedAt = Number(raw.updatedAt || 0);

  if (!apiBaseUrl || !imageBaseUrl || !Number.isFinite(updatedAt)) return null;
  if (Date.now() - updatedAt > ttlMs) return null;

  return {
    apiBaseUrl,
    imageBaseUrl,
    imagePool: imagePool.length > 0 ? imagePool : [imageBaseUrl],
    hostPool,
    updatedAt,
  };
}

/**
 * 端点唯一真相源: 读缓存快照, 空缓存回退默认值.
 * 调用方禁止在模块变量里另存一份 endpoint, 全部经由这里.
 */
export async function getEndpoints(): Promise<{
  apiBaseUrl: string;
  imageBaseUrl: string;
  imagePool: string[];
  hostPool: string[];
}> {
  const cached = await getRuntimeEndpointCache();
  if (cached) {
    return {
      apiBaseUrl: cached.apiBaseUrl,
      imageBaseUrl: cached.imageBaseUrl,
      imagePool: cached.imagePool,
      hostPool: cached.hostPool,
    };
  }
  return {
    apiBaseUrl: Config.JM_FALLBACK_API_BASE,
    imageBaseUrl: Config.JM_FALLBACK_IMAGE_BASE,
    imagePool: [Config.JM_FALLBACK_IMAGE_BASE],
    hostPool: [],
  };
}

export async function getApiBaseUrl(): Promise<string> {
  return (await getEndpoints()).apiBaseUrl;
}

export async function getImageBaseUrl(): Promise<string> {
  return (await getEndpoints()).imageBaseUrl;
}

export async function getImagePool(): Promise<string[]> {
  return (await getEndpoints()).imagePool;
}

export async function getApiPool(): Promise<string[]> {
  return (await getEndpoints()).hostPool;
}

export async function setRuntimeEndpointCache(input: {
  apiBaseUrl: string;
  imageBaseUrl: string;
  imagePool: string[];
  hostPool: string[];
}) {
  const image = String(input.imageBaseUrl || "").trim() || Config.JM_FALLBACK_IMAGE_BASE;
  await cacheSet(scopedKey("runtime:endpoints"), {
    apiBaseUrl: String(input.apiBaseUrl || "").trim(),
    imageBaseUrl: image,
    imagePool: Array.isArray(input.imagePool)
      ? input.imagePool.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    hostPool: Array.isArray(input.hostPool)
      ? input.hostPool.map((item) => String(item || "").trim()).filter(Boolean)
      : [],
    updatedAt: Date.now(),
  });
}

export async function clearRuntimeEndpointCache() {
  await cacheDelete(scopedKey("runtime:endpoints"));
}

/**
 * 剔除坏节点: 从缓存池里去掉 failedBase, 首选顺延到下一条.
 * 返回剔除后的快照; 池里只剩一条或找不到时返回 null(调用方不 failover).
 */
export async function dropFailedApiBase(
  failedBase: string,
): Promise<RuntimeEndpointCache | null> {
  const cached = await getRuntimeEndpointCache();
  if (!cached || cached.hostPool.length <= 1) return null;
  const remaining = cached.hostPool.filter((base) => base !== failedBase);
  if (remaining.length === 0 || remaining.length === cached.hostPool.length) {
    return null;
  }
  const next: RuntimeEndpointCache = {
    apiBaseUrl: remaining[0]!,
    imageBaseUrl: cached.imageBaseUrl,
    imagePool: cached.imagePool,
    hostPool: remaining,
    updatedAt: Date.now(),
  };
  await cacheSet(scopedKey("runtime:endpoints"), next);
  return next;
}

/**
 * 剔除坏图床: 从 imagePool 去掉 failedBase, 首选顺延.
 * 池里只剩一条或找不到时返回 null(调用方不 failover).
 */
export async function dropFailedImageBase(
  failedBase: string,
): Promise<RuntimeEndpointCache | null> {
  const cached = await getRuntimeEndpointCache();
  if (!cached || cached.imagePool.length <= 1) return null;
  const remaining = cached.imagePool.filter((base) => base !== failedBase);
  if (remaining.length === 0 || remaining.length === cached.imagePool.length) {
    return null;
  }
  const next: RuntimeEndpointCache = {
    apiBaseUrl: cached.apiBaseUrl,
    imageBaseUrl: remaining[0]!,
    imagePool: remaining,
    hostPool: cached.hostPool,
    updatedAt: Date.now(),
  };
  await cacheSet(scopedKey("runtime:endpoints"), next);
  return next;
}
