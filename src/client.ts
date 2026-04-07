import type { AxiosResponse } from "axios";
import axios from "axios";
import { decodeResponsePayload } from "./codec";
import { Config } from "./constants";
import { resolveServerMessage, toFriendlyError } from "./errors";
import {
  cacheKeyFromConfig,
  getCachedResponse,
  getJwtToken,
  getUserAgent,
  setCachedResponse,
  setJwtToken,
} from "./state";
import type { JmMeta, JmRequestConfig } from "./types";
import { getHost, md5Hex, nowTs } from "./utils";

type UnauthorizedErrorPayload = {
  type: "unauthorized";
  source: string;
  message: string;
  scheme?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

const JM_PLUGIN_ID = "bf99008d-010b-4f17-ac7c-61a9b57dc3d9";

let unauthorizedSchemeProvider:
  | (() => Promise<Record<string, unknown> | undefined>)
  | null = null;

export function setUnauthorizedSchemeProvider(
  provider: () => Promise<Record<string, unknown> | undefined>,
) {
  unauthorizedSchemeProvider = provider;
}

async function buildUnauthorizedError(
  message = "登录过期，请重新登录",
): Promise<Error> {
  const payload: UnauthorizedErrorPayload = {
    type: "unauthorized",
    source: JM_PLUGIN_ID,
    message,
  };
  try {
    const bundle = await unauthorizedSchemeProvider?.();
    if (bundle && typeof bundle === "object") {
      payload.scheme = (bundle.scheme as Record<string, unknown>) ?? undefined;
      payload.data = (bundle.data as Record<string, unknown>) ?? undefined;
    }
  } catch (_) {
    // ignore scheme build errors
  }
  return new Error(JSON.stringify(payload));
}

function isLoginRequest(url: unknown): boolean {
  return String(url || "")
    .toLowerCase()
    .includes("/login");
}

function looksLikeCredentialError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("账号") ||
    text.includes("帳號") ||
    text.includes("用户名") ||
    text.includes("密码") ||
    text.includes("密碼") ||
    text.includes("password") ||
    text.includes("credential")
  );
}

export function createJmClient() {
  const client = axios.create({
    timeout: 10000,
    validateStatus: () => true,
  });

  async function parseResponse(
    response: AxiosResponse,
  ): Promise<AxiosResponse> {
    const cfg = response.config as JmRequestConfig;
    const meta = cfg.__jmMeta;

    const decoded = await decodeResponsePayload(
      response.data,
      meta?.ts || nowTs(),
    );
    const status = Number(response.status || 0);

    if (status < 200 || status >= 300) {
      console.error(
        `服务器响应异常 (${status || "unknown"}) ${JSON.stringify(decoded)}`,
      );
      const serverMsg = resolveServerMessage(
        decoded,
        `服务器响应异常 (${status || "unknown"})`,
      );
      if (isLoginRequest(cfg.url)) {
        console.error(
          `[jm.login] failed status=${status || "unknown"} message=${serverMsg} body=${JSON.stringify(decoded)}`,
        );
        if (status === 401 || looksLikeCredentialError(serverMsg)) {
          throw new Error(serverMsg || "账号或密码错误");
        }
        throw new Error(serverMsg || "登录失败");
      }
      if (status === 401 || serverMsg === "請先登入會員") {
        throw await buildUnauthorizedError("登录过期，请重新登录");
      }
      throw new Error(serverMsg);
    }

    if (isLoginRequest(cfg.url)) {
      const serverMsg = resolveServerMessage(decoded, "");
      if (looksLikeCredentialError(serverMsg)) {
        console.error(
          `[jm.login] credential_error message=${serverMsg} body=${JSON.stringify(decoded)}`,
        );
      }
    }

    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      const nextJwt = String(
        (decoded as Record<string, unknown>).jwttoken || "",
      ).trim();
      if (nextJwt) {
        setJwtToken(nextJwt);
      }
    }

    if (
      !meta?.fromCache &&
      meta?.cacheEnabled &&
      String(cfg.method || "GET").toUpperCase() === "GET"
    ) {
      setCachedResponse(
        {
          method: String(cfg.method || "GET").toUpperCase(),
          url: String(cfg.url || ""),
          params: cfg.params as Record<string, unknown> | undefined,
          data: cfg.data,
        },
        decoded,
      );
    }

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
      "user-agent": getUserAgent(),
    };

    const host = getHost(url);
    if (host) {
      authHeaders.Host = host;
    }

    if (meta.useJwt) {
      const jwt = getJwtToken();
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
      const cached = getCachedResponse(cacheConfig);
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
        try {
          return await parseResponse(raw.response);
        } catch (parseErr) {
          return Promise.reject(toFriendlyError(parseErr));
        }
      }
      return Promise.reject(toFriendlyError(err));
    },
  );

  return client;
}
