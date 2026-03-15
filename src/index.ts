import axios from "axios";
import { runtime } from "../type/runtime-api";
import { createJmClient } from "./client";
import { toFriendlyError } from "./errors";
import { buildRequestConfig } from "./request-config";
import { getCachedResponse } from "./state";
import type { RequestPayload } from "./types";

const jmClient = createJmClient();

async function fetchImageBytes({ url = "", timeoutMs = 30000 } = {}) {
  const targetUrl = url.trim();
  if (!targetUrl) throw new Error("url 不能为空");

  const { host } = new URL(targetUrl);

  const response = await axios.get(targetUrl, {
    headers: { Host: host },
    timeout: Math.max(0, timeoutMs) || 30000,
    responseType: "arraybuffer",
  });

  const nativeBufferId = await runtime.native.put(
    new Uint8Array(response.data),
  );

  return { nativeBufferId: Number(nativeBufferId) };
}

async function jmRequest(input: RequestPayload) {
  const { config, cacheEnabled } = buildRequestConfig(input);

  try {
    const response = await jmClient.request(config);
    return response.data;
  } catch (err) {
    if (
      cacheEnabled &&
      String(config.method || "GET").toUpperCase() === "GET"
    ) {
      const cached = getCachedResponse({
        method: String(config.method || "GET").toUpperCase(),
        url: String(config.url || ""),
        params: config.params as Record<string, unknown> | undefined,
        data: config.data,
      });
      if (cached !== null && cached !== undefined) {
        return cached;
      }
    }
    throw toFriendlyError(err);
  }
}

async function testUrlSpeed(url: string) {
  const start = Date.now();
  try {
    await axios.get(url, { timeout: 5000 });
    return { url, duration: Date.now() - start };
  } catch (error) {
    return { url, duration: null };
  }
}

async function getFastestUrlIndex(urls: string[]) {
  if (!urls || urls.length === 0) return 0;

  const testPromises = urls.map((url) => testUrlSpeed(url));

  const results = await Promise.all(testPromises);

  const successfulResults = results.filter((r) => r.duration !== null);

  if (successfulResults.length === 0) {
    return 0;
  }

  const fastestResult = successfulResults.reduce((prev, curr) =>
    curr.duration < prev.duration ? curr : prev,
  );

  return urls.indexOf(fastestResult.url);
}

export default {
  jmRequest,
  fetchImageBytes,
  getFastestUrlIndex,
};
