import type { JmRequestConfig, RequestPayload } from "./types";
import { nowTs, toQueryString } from "./utils";

export type BuiltRequest = {
  config: JmRequestConfig;
  cacheEnabled: boolean;
};

export async function buildRequestConfig(input: RequestPayload): Promise<BuiltRequest> {
  const method = String(input.method || "GET").toUpperCase();
  let url = String(input.path || input.url || "").trim();
  if (!url) {
    throw new Error("请求地址不能为空");
  }
  if (
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) &&
    !url.startsWith("/") &&
    /^[^/:?#]+\.[^/:?#]+([/?#]|$)/.test(url)
  ) {
    // 裸域名无 scheme 时 axios(无 baseURL)直接抛 relative URL without a base, 这里补 https://
    url = `https://${url}`;
  }

  const headers: Record<string, string> = {};
  let body = input.data;
  if (method === "POST" && input.formData) {
    body = toQueryString(input.formData);
    headers["content-type"] = "application/x-www-form-urlencoded";
  } else if (method === "POST" && typeof body === "string") {
    headers["content-type"] = headers["content-type"] || "application/x-www-form-urlencoded";
  }

  const cacheEnabled = input.cache === true;
  const config: JmRequestConfig = {
    method,
    url,
    params: input.params,
    data: body,
    headers: headers as unknown as JmRequestConfig["headers"],
    timeout: 10000,
    responseType: "arraybuffer",
    validateStatus: () => true,
    __jmMeta: {
      ts: nowTs(),
      cacheEnabled,
    },
  };

  return { config, cacheEnabled };
}
