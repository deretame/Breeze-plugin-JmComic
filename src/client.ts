import type { AxiosResponse } from "axios";
import axios from "axios";
import { buildUnauthorizedError } from "breeze-plugin-kit";
import { decodeResponsePayload } from "./codec";
import { Config } from "./constants";
import { resolveServerMessage } from "./errors";
import {
  cacheKeyFromConfig,
  getCachedResponse,
  getJwtToken,
  getUserAgent,
  setJwtToken,
} from "./state";
import type { JmMeta, JmRequestConfig } from "./types";
import { getHost, md5Hex, nowTs } from "./utils";

const JM_PLUGIN_ID = "bf99008d-010b-4f17-ac7c-61a9b57dc3d9";

export function createJmClient() {
  const client = axios.create({
    timeout: 10000,
    validateStatus: () => true,
  });

  async function parseResponse(response: AxiosResponse): Promise<AxiosResponse> {
    const cfg = response.config as JmRequestConfig;
    const meta = cfg.__jmMeta;

    const decoded = await decodeResponsePayload(response.data, meta?.ts || nowTs());
    const status = Number(response.status || 0);

    if (status < 200 || status >= 300) {
      const serverMsg = resolveServerMessage(decoded, `服务器响应异常 (${status || "unknown"})`);
      const isLogin = String(cfg.url || "")
        .toLowerCase()
        .includes("/login");
      if (!isLogin && (status === 401 || serverMsg === "請先登入會員")) {
        throw buildUnauthorizedError(JM_PLUGIN_ID, "登录过期，请重新登录");
      }
      throw new Error(serverMsg);
    }

    if (decoded && typeof decoded === "object" && !Array.isArray(decoded) && "code" in decoded) {
      const bodyCode = Number((decoded as Record<string, unknown>).code);
      if (Number.isFinite(bodyCode) && bodyCode !== 200) {
        const serverMsg = resolveServerMessage(decoded, `请求失败 (${bodyCode})`);
        const isLogin = String(cfg.url || "")
          .toLowerCase()
          .includes("/login");
        if (!isLogin && (bodyCode === 401 || serverMsg === "請先登入會員")) {
          throw buildUnauthorizedError(JM_PLUGIN_ID, "登录过期，请重新登录");
        }
        throw new Error(serverMsg);
      }
    }

    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      const nextJwt = String((decoded as Record<string, unknown>).jwttoken || "").trim();
      if (nextJwt) {
        await setJwtToken(nextJwt);
      }
    }

    // if (
    //   !meta?.fromCache &&
    //   meta?.cacheEnabled &&
    //   String(cfg.method || "GET").toUpperCase() === "GET"
    // ) {
    //   await setCachedResponse(
    //     {
    //       method: String(cfg.method || "GET").toUpperCase(),
    //       url: String(cfg.url || ""),
    //       params: cfg.params as Record<string, unknown> | undefined,
    //       data: cfg.data,
    //     },
    //     decoded,
    //   );
    // }

    response.data = decoded;
    return response;
  }

  client.interceptors.request.use(async (config) => {
    const cfg = config as JmRequestConfig;
    const method = String(cfg.method || "GET").toUpperCase();
    const url = String(cfg.url || "");
    const meta: JmMeta = cfg.__jmMeta || {
      ts: nowTs(),
      cacheEnabled: false,
      useJwt: true,
    };

    const token = await md5Hex(`${meta.ts}${Config.JM_VERSION}`);
    const authHeaders: Record<string, string> = {
      token,
      tokenparam: `${meta.ts},${Config.JM_VERSION}`,
      "user-agent": await getUserAgent(),
    };

    const host = getHost(url);
    if (host) {
      authHeaders.Host = host;
    }

    if (meta.useJwt) {
      const jwt = await getJwtToken();
      if (jwt) {
        authHeaders.Authorization = `Bearer ${jwt}`;
      }
    }

    cfg.headers = {
      ...(cfg.headers as Record<string, unknown>),
      ...authHeaders,
    } as unknown as JmRequestConfig["headers"];

    if (meta.cacheEnabled && method === "GET") {
      const cacheConfig = {
        method,
        url,
        params: cfg.params as Record<string, unknown> | undefined,
        data: cfg.data,
      };
      meta.cacheKey = cacheKeyFromConfig(cacheConfig);
      const cached = await getCachedResponse(cacheConfig);
      if (cached !== null && cached !== undefined) {
        meta.fromCache = true;
        cfg.adapter = async () => ({
          data: cached,
          status: 200,
          statusText: "OK",
          headers: {},
          config: cfg,
          request: undefined,
        });
      }
    }

    cfg.__jmMeta = meta;
    return cfg;
  });

  client.interceptors.response.use(
    (response: AxiosResponse) => parseResponse(response),
    async (err: unknown) => {
      const raw = err as { response?: AxiosResponse };
      if (raw?.response) {
        return parseResponse(raw.response);
      }
      throw err;
    },
  );

  return client;
}
