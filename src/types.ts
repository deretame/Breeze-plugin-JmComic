import type { InternalAxiosRequestConfig } from "axios";

export type RequestPayload = {
  path?: string;
  url?: string;
  method?: string;
  params?: Record<string, unknown>;
  data?: unknown;
  formData?: Record<string, unknown>;
  cache?: boolean;
};

export type JmMeta = {
  ts: string;
  cacheEnabled: boolean;
  cacheKey?: string;
  fromCache?: boolean;
};

export type JmRequestConfig = InternalAxiosRequestConfig & {
  __jmMeta?: JmMeta;
};

export type CacheKeyConfig = {
  method: string;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
};
