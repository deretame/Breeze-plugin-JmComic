import axios from "axios";
import { decodeResponsePayload } from "./codec";
import { Config } from "./constants";
import { md5Hex } from "./utils";

/** 测速探针走的真实业务链路: setting API, 与运行时请求头一致. */
const SETTING_PROBE_PATH = "/setting?app_img_shunt=1";

export const PROBE_TIMEOUT_MS = 5000;
export const HOSTCFG_TIMEOUT_MS = 5000;
export const PROBE_CONCURRENCY = 6;

export type ProbeOutcome =
  | { status: "ok"; latencyMs: number }
  | { status: "degraded"; latencyMs: number; httpStatus: number }
  | { status: "dead"; reason: string };

export type EndpointProbe = {
  baseUrl: string;
  outcome: ProbeOutcome;
  /** ok 时为 setting API 解包后的对象, 供选线直接取 img_host, 避免二次请求. */
  setting?: Record<string, unknown>;
};

export function normalizeBaseUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/+$/g, "");
  }
  return `https://${raw}`.replace(/\/+$/g, "");
}

/**
 * 对单个域名打 setting 探针.
 * - 2xx (+setting 解包成功) => ok
 * - 其它 HTTP 状态 => degraded (线路活着但限流/WAF, 降权不断连)
 * - 超时/DNS/连接失败 => dead
 */
export async function probeDomain(
  domain: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<EndpointProbe> {
  const baseUrl = normalizeBaseUrl(domain);
  if (!baseUrl) {
    return { baseUrl: "", outcome: { status: "dead", reason: "empty" } };
  }
  const tsSec = String(Math.floor(Date.now() / 1000));
  const token = await md5Hex(`${tsSec}${Config.JM_SECRET}`);
  const url = `${baseUrl}${SETTING_PROBE_PATH}&t=${tsSec}`;
  const start = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      responseType: "arraybuffer",
      validateStatus: () => true,
      headers: {
        Tokenparam: `${tsSec},${Config.JM_VERSION}`,
        Token: token,
      },
    });
    const latencyMs = Date.now() - start;
    const status = Number(response.status || 0);
    if (status >= 200 && status < 300) {
      const decoded = await decodeResponsePayload(response.data, tsSec);
      if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
        return {
          baseUrl,
          outcome: { status: "ok", latencyMs },
          setting: decoded as Record<string, unknown>,
        };
      }
      // 2xx 但解包失败:疑似中间页/劫持,降权不断连
      return {
        baseUrl,
        outcome: { status: "degraded", latencyMs, httpStatus: status },
      };
    }
    return {
      baseUrl,
      outcome: { status: "degraded", latencyMs, httpStatus: status },
    };
  } catch (error) {
    const code = String((error as { code?: string } | null)?.code || "").toUpperCase();
    const message = String((error as { message?: string } | null)?.message || error);
    const reason =
      code.includes("TIMEOUT") || code === "ECONNABORTED"
        ? `timeout@${timeoutMs}ms`
        : (code || message).slice(0, 80);
    return { baseUrl, outcome: { status: "dead", reason } };
  }
}

/** 有限并发跑完所有探针(避免 host 池大时 thundering herd). */
export async function probeAll(
  domains: string[],
  options: { timeoutMs?: number; concurrency?: number } = {},
): Promise<EndpointProbe[]> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const concurrency = Math.max(1, options.concurrency ?? PROBE_CONCURRENCY);
  const queue = domains.map(normalizeBaseUrl).filter(Boolean);
  const results: EndpointProbe[] = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const domain = queue.shift()!;
      results.push(await probeDomain(domain, timeoutMs));
    }
  });
  await Promise.all(workers);
  return results;
}

/** 排序后的可用线路池: 首选第一条, 失败按序 failover. dead 线路不入池. */
export type OrderedPool = {
  ordered: string[];
  probes: EndpointProbe[];
};

export function orderPool(probes: EndpointProbe[]): OrderedPool {
  const rank = (outcome: ProbeOutcome): number => {
    if (outcome.status === "ok") return 0;
    if (outcome.status === "degraded") return 1;
    return 2;
  };
  const latency = (outcome: ProbeOutcome): number =>
    outcome.status === "dead" ? Number.MAX_SAFE_INTEGER : outcome.latencyMs;
  const ordered = probes
    .filter((probe) => probe.outcome.status !== "dead")
    .sort((a, b) => rank(a.outcome) - rank(b.outcome) || latency(a.outcome) - latency(b.outcome))
    .map((probe) => probe.baseUrl)
    .filter(Boolean);
  return { ordered, probes };
}

export type ImageProbe = {
  baseUrl: string;
  outcome: ProbeOutcome;
};

/**
 * 图床探针: 打各线路 setting 自带的占位图真实 URL, 200 + body 非空才算通.
 * 跟官方 testHostSpeed 一致: img_host 不开 CORS 但插件侧 axios 不受限,
 * 直接取正文, 既验连通又验内容, 根路径 WAF 拦也误杀不了.
 */
export const IMAGE_PROBE_PATH = "/media/users/nopic-.gif?v=0";

export async function probeImageHost(
  imageBaseUrl: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<ImageProbe> {
  const baseUrl = normalizeBaseUrl(imageBaseUrl);
  if (!baseUrl) {
    return { baseUrl: "", outcome: { status: "dead", reason: "empty" } };
  }
  const url = `${baseUrl}${IMAGE_PROBE_PATH}`;
  const start = Date.now();
  try {
    const response = await axios.get(url, {
      timeout: timeoutMs,
      responseType: "arraybuffer",
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - start;
    const status = Number(response.status || 0);
    const bytes = (response.data as ArrayBuffer)?.byteLength ?? 0;
    if (status >= 200 && status < 300 && bytes > 0) {
      return { baseUrl, outcome: { status: "ok", latencyMs } };
    }
    return { baseUrl, outcome: { status: "dead", reason: `http=${status} bytes=${bytes}` } };
  } catch (error) {
    const code = String((error as { code?: string } | null)?.code || "").toUpperCase();
    const message = String((error as { message?: string } | null)?.message || error);
    const reason =
      code.includes("TIMEOUT") || code === "ECONNABORTED"
        ? `timeout@${timeoutMs}ms`
        : (code || message).slice(0, 80);
    return { baseUrl, outcome: { status: "dead", reason } };
  }
}

/** 图床池排序: 只有 ok 入池, 按延迟. 非 200/空 body 直接判死, 无 degraded 档. */
export function orderImagePool(probes: ImageProbe[]): string[] {
  const ok = probes.filter(
    (probe): probe is ImageProbe & { outcome: { status: "ok"; latencyMs: number } } =>
      probe.outcome.status === "ok" && Boolean(probe.baseUrl),
  );
  const ordered = ok
    .sort((a, b) => a.outcome.latencyMs - b.outcome.latencyMs)
    .map((probe) => probe.baseUrl);
  return ordered;
}
