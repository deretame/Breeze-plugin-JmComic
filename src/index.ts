import axios from "axios";
import { runtime } from "../type/runtime-api";
import { imagesUrlIndex, imagesUrls } from "./constants";
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

type ComicDetailPayload = {
  comicId?: string;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmSearchPayload = {
  keyword?: string;
  page?: number;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmChapterPayload = {
  comicId?: string;
  chapterId?: string;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmHomePayload = {
  page?: number;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmRankingPayload = {
  page?: number;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmLoginPayload = {
  account?: string;
  password?: string;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

function toNum(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toStrList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => String(item ?? ""))
    .filter((item) => item.trim().length > 0);
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return fallback;
}

function buildMetadata(type: string, name: string, value: unknown) {
  const list = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value];
  const normalized = list
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);

  if (!normalized.length) {
    return null;
  }

  return {
    type,
    name,
    value: normalized,
  };
}

function buildJmCoverUrl(item: any): string {
  const image = String(item?.image ?? "").trim();
  if (image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }

  const id = String(item?.id ?? "").trim();
  const imageBase = String(imagesUrls[imagesUrlIndex] ?? imagesUrls[0] ?? "").trim();
  if (!id || !imageBase) {
    return image;
  }

  return `${imageBase}/media/albums/${id}_3x4.jpg`;
}

function toComicItem(item: any) {
  const id = String(item?.id ?? "");
  return {
    source: "jm",
    id,
    title: String(item?.name ?? ""),
    subtitle: "",
    finished: false,
    likesCount: toNum(item?.likes),
    viewsCount: toNum(item?.total_views ?? item?.totalViews),
    updatedAt: String(item?.update_at ?? ""),
    cover: {
      id,
      url: buildJmCoverUrl(item),
      extra: {
        path: `${id}.jpg`,
      },
    },
    metadata: [
      buildMetadata("author", "作者", item?.author),
      buildMetadata("categories", "分类", [
        item?.category?.title,
        item?.category_sub?.title,
      ]),
      buildMetadata("tags", "标签", item?.tags),
      buildMetadata("works", "作品", item?.works),
      buildMetadata("actors", "角色", item?.actors),
    ].filter(Boolean),
    raw: {
      id,
      author: String(item?.author ?? ""),
      description: item?.description ?? "",
      name: String(item?.name ?? ""),
      image: String(item?.image ?? ""),
      category: {
        id: String(item?.category?.id ?? ""),
        title: String(item?.category?.title ?? ""),
      },
      category_sub: {
        id: item?.category_sub?.id == null ? null : String(item.category_sub.id),
        title:
          item?.category_sub?.title == null
            ? null
            : String(item.category_sub.title),
      },
      liked: toBool(item?.liked),
      is_favorite: toBool(item?.is_favorite),
      update_at: toNum(item?.update_at),
      likes: toNum(item?.likes),
      totalViews: toNum(item?.total_views ?? item?.totalViews),
      tags: toStrList(item?.tags),
      works: toStrList(item?.works),
      actors: toStrList(item?.actors),
    },
    extra: {},
  };
}

function normalizeJmSeries(series: any[]): any[] {
  const cleaned = Array.isArray(series) ? series : [];
  return cleaned
    .filter((item) => String(item?.sort ?? "") !== "0")
    .map((item) => ({
      ...item,
      id: String(item?.id ?? ""),
      sort: String(item?.sort ?? ""),
      name: `第${String(item?.sort ?? "")}话 ${String(item?.name ?? "")}`,
    }));
}

function toStringMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function sortByToOrder(value: unknown): string {
  const sortBy = Number(value);
  if (sortBy === 2) return "mv";
  if (sortBy === 3) return "mp";
  if (sortBy === 4) return "tf";
  return "";
}

async function loadPluginSetting(key: string, fallback: unknown) {
  const raw = await runtime.pluginConfig.loadPluginConfig(
    key,
    JSON.stringify(fallback),
  );
  try {
    const decoded = JSON.parse(String(raw));
    if (decoded?.ok === true) {
      return decoded.value;
    }
  } catch (_) {
    // noop
  }
  return fallback;
}

async function getSettingsBundle() {
  const [baseUrl, jwtToken] = await Promise.all([
    loadPluginSetting("network.baseUrl", "https://www.cdnsha.org"),
    loadPluginSetting("auth.jwt", ""),
  ]);

  return {
    source: "jm",
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          id: "network",
          title: "网络",
          fields: [
            { key: "network.baseUrl", kind: "text", label: "接口域名" },
            { key: "auth.jwt", kind: "password", label: "JWT" },
          ],
        },
      ],
    },
    data: {
      values: {
        "network.baseUrl": String(baseUrl ?? ""),
        "auth.jwt": String(jwtToken ?? ""),
      },
    },
  };
}

async function getLoginBundle() {
  return {
    source: "jm",
    scheme: {
      version: "1.0.0",
      type: "login",
      title: "禁漫登录",
      fields: [
        { key: "account", kind: "text", label: "用户名" },
        { key: "password", kind: "password", label: "密码" },
      ],
      action: {
        fnPath: "loginWithPassword",
        submitText: "登录",
      },
    },
    data: {
      account: String(await loadPluginSetting("auth.account", "")),
      password: String(await loadPluginSetting("auth.password", "")),
    },
  };
}

async function loginWithPassword(payload: JmLoginPayload = {}) {
  const account = String(payload.account ?? "").trim();
  const password = String(payload.password ?? "");
  if (!account || !password) {
    throw new Error("账号或密码不能为空");
  }

  const path = String(payload.path ?? "").trim() || "https://www.cdnsha.org/login";
  const result = await jmRequest({
    path,
    method: "POST",
    formData: { username: account, password },
    useJwt: false,
  });

  const jwtToken = String((result as any)?.jwttoken ?? "");

  return {
    source: "jm",
    data: {
      account,
      password,
      jwtToken,
    },
    raw: result,
  };
}

async function getCapabilitiesBundle() {
  return {
    source: "jm",
    scheme: {
      version: "1.0.0",
      type: "advancedActions",
      actions: [
        {
          key: "clear_session",
          title: "清理插件会话",
          fnPath: "clearPluginSession",
        },
        {
          key: "dump_runtime_info",
          title: "查看运行时信息",
          fnPath: "dumpRuntimeInfo",
        },
      ],
    },
    data: {
      actions: ["clear_session", "dump_runtime_info"],
    },
  };
}

async function clearPluginSession() {
  await Promise.all([
    runtime.pluginConfig.savePluginConfig("auth.account", JSON.stringify("")),
    runtime.pluginConfig.savePluginConfig("auth.password", JSON.stringify("")),
    runtime.pluginConfig.savePluginConfig("auth.jwt", JSON.stringify("")),
  ]);

  return {
    ok: true,
    message: "jm 插件会话已清理",
  };
}

async function dumpRuntimeInfo() {
  return {
    ok: true,
    data: {
      pluginName: "jmComic",
      hasCacheApi: !!runtime.cache,
      hasPluginConfigApi: !!runtime.pluginConfig,
      now: new Date().toISOString(),
    },
  };
}

function timestampToIso(value: unknown): string {
  const seconds = toNum(value, 0);
  if (seconds <= 0) {
    return new Date().toISOString();
  }
  return new Date(seconds * 1000).toISOString();
}

async function getComicDetail(payload: ComicDetailPayload = {}) {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const path = String(payload.path ?? "").trim() || "https://www.cdnsha.org/album";

  const response = (await jmRequest({
    path,
    method: "GET",
    params: { id: comicId },
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  })) as Record<string, any>;

  const series = normalizeJmSeries(response.series as any[]);
  const normalizedInfo = {
    ...response,
    id: toNum(response.id),
    name: String(response.name ?? ""),
    description: String(response.description ?? ""),
    addtime: String(response.addtime ?? "0"),
    total_views: String(response.total_views ?? "0"),
    likes: String(response.likes ?? "0"),
    comment_total: String(response.comment_total ?? "0"),
    author: toStrList(response.author),
    tags: toStrList(response.tags),
    works: toStrList(response.works),
    actors: toStrList(response.actors),
    related_list: Array.isArray(response.related_list) ? response.related_list : [],
    liked: toBool(response.liked),
    is_favorite: toBool(response.is_favorite),
    is_aids: toBool(response.is_aids),
    price: String(response.price ?? "0"),
    purchased: String(response.purchased ?? "0"),
    series,
  };

  const normal = {
    comicInfo: {
      id: String(normalizedInfo.id),
      creator: {
        id: "",
        name: "",
        avatar: { url: "", path: "", name: "" },
      },
      title: normalizedInfo.name,
      description: normalizedInfo.description,
      cover: { url: "", path: "", name: "" },
      categories: [],
      tags: normalizedInfo.tags,
      author: normalizedInfo.author,
      works: normalizedInfo.works,
      actors: normalizedInfo.actors,
      chineseTeam: [],
      pagesCount: 0,
      epsCount: normalizedInfo.series.length > 0 ? normalizedInfo.series.length : 1,
      updated_at: timestampToIso(normalizedInfo.addtime),
      allowComment: true,
      totalViews: toNum(normalizedInfo.total_views),
      totalLikes: toNum(normalizedInfo.likes),
      totalComments: toNum(normalizedInfo.comment_total),
      isFavourite: toBool(normalizedInfo.is_favorite),
      isLiked: toBool(normalizedInfo.liked),
    },
    eps: normalizedInfo.series.map((item: any) => ({
      id: String(item?.id ?? ""),
      name: String(item?.name ?? ""),
      order: toNum(item?.sort),
    })),
    recommend: (normalizedInfo.related_list as any[]).map((item: any) => ({
      id: String(item?.id ?? ""),
      title: String(item?.name ?? ""),
      cover: { url: "", path: "", name: "" },
    })),
  };

  const scheme = {
    version: "1.0.0",
    type: "comicDetail",
    source: "jm",
  };

  const data = {
    normal,
    raw: {
      comicInfo: normalizedInfo,
    },
  };

  return {
    source: "jm",
    comicId,
    extern: payload.extern ?? null,
    scheme,
    data,
    normal: data.normal,
    raw: data.raw,
  };
}

async function searchComic(payload: JmSearchPayload = {}) {
  const extern = toStringMap(payload.extern);
  const page = Math.max(1, toNum(payload.page, 1));
  const keyword = String(payload.keyword ?? extern.keyword ?? "").trim();
  const order = String(extern.sort ?? sortByToOrder(extern.sortBy)).trim();
  const path = String(payload.path ?? extern.path ?? "").trim() || "https://www.cdnsha.org/search";

  const response = (await jmRequest({
    path,
    method: "GET",
    params: {
      search_query: keyword,
      page,
      o: order,
    },
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  })) as Record<string, any>;

  const content = Array.isArray(response.content) ? response.content : [];

  const scheme = {
    version: "1.0.0",
    type: "searchResult",
    source: "jm",
    list: "comicGrid",
  };

  const data = {
    paging: {
      page,
      pages: page,
      total: toNum(response.total, content.length),
      hasReachedMax: content.length < 80,
    },
    items: content.map((item: any) => toComicItem(item)),
  };

  return {
    source: "jm",
    extern: payload.extern ?? null,
    scheme,
    data,
    paging: data.paging,
    items: data.items,
  };
}

async function getHomeData(payload: JmHomePayload = {}) {
  const page = Number.isFinite(Number(payload.page)) ? Number(payload.page) : -1;
  const extern = toStringMap(payload.extern);

  const buildSectionAction = (section: any) => {
    const title = String(section?.title ?? "");
    const id = toNum(section?.id);

    if (title.includes("推荐")) {
      return {
        type: "openRoute",
        payload: {
          route: "jmPromoteList",
          args: { id, name: title },
        },
      };
    }
    if (title === "连载更新→右滑看更多→") {
      return {
        type: "openRoute",
        payload: { route: "jmWeekRanking" },
      };
    }
    if (title === "禁漫汉化组") {
      return {
        type: "openRoute",
        payload: {
          route: "timeRanking",
          args: { tag: "禁漫汉化组", title },
        },
      };
    }
    if (title === "韩漫更新") {
      return {
        type: "openRoute",
        payload: {
          route: "timeRanking",
          args: { tag: "hanManTypeMap", title },
        },
      };
    }
    if (title === "其他更新") {
      return {
        type: "openRoute",
        payload: {
          route: "timeRanking",
          args: { tag: "qiTaLeiTypeMap", title },
        },
      };
    }

    return {
      type: "none",
      payload: {},
    };
  };

  if (page <= -1) {
    const path =
      String(payload.path ?? extern.promotePath ?? "").trim() ||
      "https://www.cdnsha.org/promote?page=0";
    const promote = await jmRequest({
      path,
      method: "GET",
      cache: true,
      useJwt: payload.useJwt ?? true,
      jwtToken: payload.jwtToken,
    });

    const sections = (Array.isArray(promote) ? promote : []).map((section: any) => ({
      id: String(section?.id ?? ""),
      title: String(section?.title ?? ""),
      action: buildSectionAction(section),
      items: (Array.isArray(section?.content) ? section.content : []).map(
        toComicItem,
      ),
      raw: section,
    }));

    return {
      source: "jm",
      extern: payload.extern ?? null,
      scheme: {
        version: "1.0.0",
        type: "homeFeed",
        sections: [
          { type: "horizontalComicSections", key: "sections" },
          { type: "comicGrid", key: "suggestionItems" },
        ],
      },
      data: {
        page,
        sections,
        suggestionItems: [],
      },
    };
  }

  const path =
    String(payload.path ?? extern.suggestionPath ?? "").trim() ||
    "https://www.cdnsha.org/latest";
  const suggestion = await jmRequest({
    path,
    method: "GET",
    params: { page },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  const suggestionItems = (Array.isArray(suggestion) ? suggestion : []).map(
    toComicItem,
  );

  return {
    source: "jm",
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "homeFeed",
      sections: [
        { type: "horizontalComicSections", key: "sections" },
        { type: "comicGrid", key: "suggestionItems" },
      ],
    },
    data: {
      page,
      sections: [],
      suggestionItems,
      hasReachedMax: suggestionItems.length < 80,
    },
  };
}

async function getRankingData(payload: JmRankingPayload = {}) {
  const page = Number.isFinite(Number(payload.page)) ? Number(payload.page) : 0;
  const extern = toStringMap(payload.extern);
  const c = String(extern.type ?? extern.c ?? "");
  const o = String(extern.order ?? extern.o ?? "");
  const path = String(payload.path ?? "").trim() || "https://www.cdnsha.org/categories/filter";

  const raw = await jmRequest({
    path,
    method: "GET",
    params: { page, c, o },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  const total = toNum((raw as any)?.total, 0);
  const content = Array.isArray((raw as any)?.content) ? (raw as any).content : [];

  return {
    source: "jm",
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "rankingFeed",
      card: "comic",
    },
    data: {
      page,
      total,
      hasReachedMax: content.length === 0,
      items: content.map((item: any) => toComicItem(item)),
      raw,
    },
  };
}

async function getChapter(payload: JmChapterPayload = {}) {
  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) {
    throw new Error("chapterId 不能为空");
  }

  const path = String(payload.path ?? "").trim() || "https://www.cdnsha.org/chapter";
  const response = (await jmRequest({
    path,
    method: "GET",
    params: {
      skip: "",
      id: chapterId,
    },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  })) as Record<string, any>;

  const images = Array.isArray(response.images) ? response.images : [];
  const docs = images.map((image) => ({
    originalName: String(image ?? ""),
    path: String(image ?? ""),
    fileServer: "",
    id: String(response.id ?? chapterId),
  }));

  return {
    source: "jm",
    comicId: String(payload.comicId ?? ""),
    chapterId,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "chapterContent",
      source: "jm",
    },
    data: {
      chapter: {
        epId: String(response.id ?? chapterId),
        epName: String(response.name ?? ""),
        length: docs.length,
        epPages: String(docs.length),
        docs,
        series: normalizeJmSeries(response.series as any[]),
      },
    },
    chapter: {
      epId: String(response.id ?? chapterId),
      epName: String(response.name ?? ""),
      length: docs.length,
      epPages: String(docs.length),
      docs,
      series: normalizeJmSeries(response.series as any[]),
    },
  };
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
  getComicDetail,
  getSettingsBundle,
  getLoginBundle,
  loginWithPassword,
  getCapabilitiesBundle,
  clearPluginSession,
  dumpRuntimeInfo,
  getHomeData,
  getRankingData,
  searchComic,
  getChapter,
  fetchImageBytes,
  getFastestUrlIndex,
};
