import axios from "axios";
import type {
  ActionItem,
  AdvancedSearchContract,
  CapabilitiesBundleContract,
  ChapterContentContract,
  ChapterPage,
  ChapterPayload,
  ChapterWithPages,
  ComicDetailContract,
  ComicDetailData,
  ComicDetailNormal,
  ComicDetailPayload,
  ComicInfoPageAction,
  ComicListSceneBundleContract,
  CommentFeedContract,
  CommentFeedPayload,
  CommentItem,
  FavoriteWorkflowContinuePayload,
  FavoriteWorkflowInput,
  FavoriteWorkflowResult,
  FavoriteWorkflowStartPayload,
  FetchImageBytesPayload,
  FilterBundleContract,
  FunctionPageContract,
  GetFunctionPagePayload,
  ImageItem,
  InfoContract,
  LoginBundleContract,
  LoginSubmitPayload,
  LoginSubmitResult,
  MetadataListItem,
  OpenSearchAction,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  RecommendItem,
  SearchComicPayload,
  SearchResultContract,
  SettingsBundleContract,
  ToggleLikePayload,
  ToggleLikeResult,
  UserInfoBundleContract,
} from "breeze-plugin-kit";
import {
  buildLoginBundle,
  flutterTools,
  hostRuntime,
  opencc,
  pluginConfig,
  readLoginValues,
} from "breeze-plugin-kit";
import { createJmClient } from "./client";
import { Config } from "./constants";
import type { EndpointProbe, ImageProbe } from "./endpoint-pool";
import {
  HOSTCFG_TIMEOUT_MS,
  PROBE_CONCURRENCY,
  PROBE_TIMEOUT_MS,
  normalizeBaseUrl,
  orderImagePool,
  orderPool,
  probeAll,
  probeImageHost,
} from "./endpoint-pool";
import { buildJmCloudFavoriteScene, buildPluginInfo } from "./get-info";
import type { BuiltRequest } from "./request-config";
import { buildRequestConfig } from "./request-config";
import {
  clearRuntimeEndpointCache,
  dropFailedApiBase,
  dropFailedImageBase,
  getApiBaseUrl,
  getApiPool,
  getCachedResponse,
  getEndpoints,
  getImageBaseUrl,
  getImagePool,
  getRuntimeEndpointCache,
  setRuntimeEndpointCache,
} from "./state";
import type { RequestPayload } from "./types";
import {
  albumMatchesTerm,
  intersectIdLists,
  mapWithConcurrency,
  parseTagTaxonomy,
  resolveTagQueryTerm,
  splitTagTerms,
  JM_COMMON_TAGS,
  type AlbumSearchFields,
  type JmTagTaxonomy,
} from "./tag-search";
import { md5Hex } from "./utils";

const JM_PLUGIN_ID = "bf99008d-010b-4f17-ac7c-61a9b57dc3d9";

const jmClient = createJmClient();

async function fetchImageBytes({
  url = "",
  timeoutMs = 30000,
}: FetchImageBytesPayload = {}): Promise<Uint8Array<ArrayBufferLike>> {
  const targetUrl = url.trim();
  if (!targetUrl) throw new Error("url 不能为空");

  const { host } = new URL(targetUrl);

  try {
    const response = await axios.get(targetUrl, {
      headers: { Host: host },
      timeout: Math.max(0, timeoutMs) || 30000,
      responseType: "arraybuffer",
    });
    return new Uint8Array(response.data);
  } catch (err) {
    // 图床网络层失败: 在 imagePool 内切下一台重试一次
    if (!isNetworkFailure(err)) throw err;
    const pool = await getImagePool();
    const failed = pool.find((base) => targetUrl.startsWith(base));
    if (!failed || pool.length <= 1) throw err;
    const next = await dropFailedImageBase(failed);
    if (!next) throw err;
    const retryUrl = targetUrl.replace(failed, next.imageBaseUrl);
    const { host: retryHost } = new URL(retryUrl);
    const response = await axios.get(retryUrl, {
      headers: { Host: retryHost },
      timeout: Math.max(0, timeoutMs) || 30000,
      responseType: "arraybuffer",
    });
    return new Uint8Array(response.data);
  }
}

async function jmRequest(input: RequestPayload): Promise<any> {
  const { config, cacheEnabled } = await buildRequestConfig(input);

  try {
    const response = await jmClient.request(config);
    return response.data;
  } catch (err) {
    const failedUrl = String(config.url || "");
    // 坏节点剔除走缓存池: 当前失败 base 出池, 首选顺延, 不再回头
    if (isNetworkFailure(err)) {
      const pool = await getApiPool();
      const failed = pool.find((base) => failedUrl.startsWith(base));
      if (failed && pool.length > 1) {
        const next = await dropFailedApiBase(failed);
        if (next) {
          const retryConfig = {
            ...config,
            url: failedUrl.replace(failed, next.apiBaseUrl),
          };
          try {
            const response = await jmClient.request(retryConfig);
            return response.data;
          } catch (retryErr) {
            // 重试失败走统一错误处理(缓存/友好错误), 不再递归 failover
            return handleRequestError(retryErr, retryConfig, cacheEnabled);
          }
        }
      }
    }
    return handleRequestError(err, config, cacheEnabled);
  }
}

async function handleRequestError(
  err: unknown,
  config: BuiltRequest["config"],
  cacheEnabled: boolean,
) {
  if (cacheEnabled && String(config.method || "GET").toUpperCase() === "GET") {
    const cached = await getCachedResponse({
      method: String(config.method || "GET").toUpperCase(),
      url: String(config.url || ""),
      params: config.params as Record<string, unknown> | undefined,
      data: config.data,
    });
    if (cached !== null && cached !== undefined) {
      return cached;
    }
  }
  throw err;
}

function isNetworkFailure(err: unknown): boolean {
  const code = String((err as { code?: string } | null)?.code || "").toUpperCase();
  if (
    code === "ECONNABORTED" ||
    code === "ERR_NETWORK" ||
    code === "ERR_CANCELED" ||
    code === "ETIMEDOUT"
  ) {
    return true;
  }
  // axios 超时无 code 时 message 兜底
  const message = String((err as { message?: string } | null)?.message || "").toLowerCase();
  return message.includes("timeout") || message.includes("network");
}

type JmSearchPayload = SearchComicPayload;

type JmReadSnapshotPayload = ReadSnapshotPayload;

type JmHomePayload = {
  page?: number;
  extern?: Record<string, unknown>;
};

type JmRankingPayload = {
  page?: number;
  extern?: Record<string, unknown>;
};

type JmPromoteListPayload = {
  id?: number;
  page?: number;
  extern?: Record<string, unknown>;
};

type JmWeekRankingPayload = {
  date?: number;
  type?: string;
  page?: number;
  extern?: Record<string, unknown>;
};

type JmCloudFavoritePayload = {
  page?: number;
  folderId?: string;
  order?: string;
  extern?: Record<string, unknown>;
};

type JmLikePayload = ToggleLikePayload;

type JmCommentFeedPayload = CommentFeedPayload;

type RankingFilterOption = {
  label: string;
  value: string;
  result: Record<string, unknown>;
  children?: RankingFilterOption[];
};

type JmLoginPayload = LoginSubmitPayload & {
  account?: string;
  password?: string;
};

function toNum(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toStrList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item ?? "")).filter((item) => item.trim().length > 0);
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

function stripHtmlTags(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatDisplayTime(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T").replace(/\//g, "-");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function createActionItem(
  name: unknown,
  onTap: ComicInfoPageAction = { type: "openSearch", payload: {} },
  extern: Record<string, string> = {},
): ActionItem {
  return {
    name: String(name ?? ""),
    onTap,
    extern,
  };
}

function createMetadataActionList(
  type: string,
  name: string,
  values: unknown,
  mapItem?: (value: string) => ActionItem,
): MetadataListItem | null {
  const list = Array.isArray(values) ? values : values == null ? [] : [values];
  const normalized = list
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0)
    .map((item) => (mapItem ? mapItem(item) : createActionItem(item)));

  if (!normalized.length) {
    return null;
  }

  return {
    type,
    name,
    value: normalized,
  };
}

function createImage(input: {
  id: unknown;
  url: unknown;
  name?: unknown;
  path?: unknown;
  extern?: Record<string, string>;
}): ImageItem {
  return {
    id: String(input.id ?? ""),
    url: String(input.url ?? ""),
    name: String(input.name ?? ""),
    path: String(input.path ?? ""),
    extern: input.extern ?? {},
  };
}

function openSearchAction(payload: Record<string, unknown>): OpenSearchAction {
  const source = String(payload.source ?? "").trim();
  const keyword = String(payload.keyword ?? "").trim();
  const inheritedExtern =
    payload.extern && typeof payload.extern === "object" && !Array.isArray(payload.extern)
      ? (payload.extern as Record<string, unknown>)
      : {};
  const extern = {
    ...inheritedExtern,
    ...(typeof payload.url === "string" && payload.url.trim().length
      ? { url: payload.url.trim() }
      : {}),
    ...(Array.isArray(payload.categories) ? { categories: payload.categories } : {}),
    ...(typeof payload.mode === "string" && payload.mode.trim().length
      ? { mode: payload.mode.trim() }
      : {}),
    ...(typeof payload.creatorId === "string" && payload.creatorId.trim().length
      ? { creatorId: payload.creatorId.trim() }
      : {}),
  };
  return {
    type: "openSearch",
    payload: {
      ...(source ? { source } : {}),
      ...(keyword ? { keyword } : {}),
      extern,
    },
  };
}

function resolveJmCoverUrl(item: unknown, imageBase: string): string {
  const record = (item ?? {}) as Record<string, unknown>;
  const image = String(record.image ?? "").trim();
  if (image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }

  if (!imageBase) {
    return image;
  }

  if (image.startsWith("/")) {
    return `${imageBase}${image}`;
  }

  if (image.startsWith("media/")) {
    return `${imageBase}/${image}`;
  }

  const id = String(record.id ?? "").trim();
  if (!id) {
    return image;
  }

  return `${imageBase}/media/albums/${id}_3x4.jpg`;
}

function toComicItem(item: any, imageBase: string) {
  const id = String(item?.id ?? "");
  return {
    source: JM_PLUGIN_ID,
    id,
    title: String(item?.name ?? ""),
    subtitle: "",
    finished: false,
    likesCount: toNum(item?.likes),
    viewsCount: toNum(item?.total_views ?? item?.totalViews),
    updatedAt: String(item?.update_at ?? ""),
    cover: {
      id,
      url: resolveJmCoverUrl(item, imageBase),
      name: `${id}.jpg`,
      path: `${id}.jpg`,
      extern: {
        path: `${id}.jpg`,
      },
    },
    metadata: [
      createMetadataActionList("author", "作者", item?.author),
      createMetadataActionList("categories", "分类", [
        item?.category?.title,
        item?.category_sub?.title,
      ]),
      createMetadataActionList("tags", "标签", item?.tags),
      createMetadataActionList("works", "作品", item?.works),
      createMetadataActionList("actors", "角色", item?.actors),
    ].filter((item): item is MetadataListItem => item != null),
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
        title: item?.category_sub?.title == null ? null : String(item.category_sub.title),
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
    extern: {},
  };
}

function normalizeJmSeries(series: any[]): any[] {
  const cleaned = Array.isArray(series) ? series : [];
  const filtered = cleaned
    .filter((item) => String(item?.sort ?? "") !== "0")
    .map((item) => ({
      ...item,
      id: String(item?.id ?? ""),
      sort: String(item?.sort ?? ""),
      rawOrder: toNum(item?.sort, 0),
      rawName: String(item?.name ?? ""),
    }))
    .sort((a, b) => toNum(a?.sort, 0) - toNum(b?.sort, 0));

  return filtered.map((item, index) => {
    const order = index + 1;
    return {
      ...item,
      order,
      name: `第${order}话 ${String(item?.rawName ?? "")}`,
    };
  });
}

function toStringMap(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function createChoiceOption(
  label: string,
  value: string,
  result: Record<string, unknown>,
  children?: RankingFilterOption[],
): RankingFilterOption {
  return { label, value, result, ...(children ? { children } : {}) };
}

function buildComicListScene(input: {
  title: string;
  list: {
    fnPath: string;
    core?: Record<string, unknown>;
    extern?: Record<string, unknown>;
  };
  filter?: {
    fnPath: string;
    core?: Record<string, unknown>;
    extern?: Record<string, unknown>;
  };
}) {
  return {
    title: input.title,
    source: JM_PLUGIN_ID,
    list: {
      fnPath: input.list.fnPath,
      core: input.list.core ?? {},
      extern: input.list.extern ?? {},
    },
    ...(input.filter
      ? {
          filter: {
            fnPath: input.filter.fnPath,
            core: input.filter.core ?? {},
            extern: input.filter.extern ?? {},
          },
        }
      : {}),
  };
}

function openComicListAction(scene: ReturnType<typeof buildComicListScene>) {
  return {
    type: "openComicList",
    payload: { scene },
  };
}

function getJmRankingCategoryOptions(): RankingFilterOption[] {
  return [
    createChoiceOption("最新a漫", "latest", { extern: { type: "0" } }),
    createChoiceOption("同人", "doujin", { extern: { type: "doujin" } }, [
      createChoiceOption("汉化", "doujin_chinese", {
        extern: { type: "doujin_chinese" },
      }),
      createChoiceOption("日语", "doujin_japanese", {
        extern: { type: "doujin_japanese" },
      }),
      createChoiceOption("CG图集", "doujin_CG", {
        extern: { type: "doujin_CG" },
      }),
    ]),
    createChoiceOption("单本", "single", { extern: { type: "single" } }, [
      createChoiceOption("汉化", "single_chinese", {
        extern: { type: "single_chinese" },
      }),
      createChoiceOption("日语", "single_japanese", {
        extern: { type: "single_japanese" },
      }),
      createChoiceOption("青年漫", "single_youth", {
        extern: { type: "single_youth" },
      }),
    ]),
    createChoiceOption("短篇", "short", { extern: { type: "short" } }, [
      createChoiceOption("汉化", "short_chinese", {
        extern: { type: "short_chinese" },
      }),
      createChoiceOption("日语", "short_japanese", {
        extern: { type: "short_japanese" },
      }),
    ]),
    createChoiceOption("其他类", "another", { extern: { type: "another" } }, [
      createChoiceOption("其他漫画", "another_other", {
        extern: { type: "another_other" },
      }),
      createChoiceOption("3D", "another_3d", {
        extern: { type: "another_3d" },
      }),
      createChoiceOption("角色扮演", "another_cosplay", {
        extern: { type: "another_cosplay" },
      }),
    ]),
    createChoiceOption("韩漫", "hanman", { extern: { type: "hanman" } }, [
      createChoiceOption("汉化", "hanman_chinese", {
        extern: { type: "hanman_chinese" },
      }),
    ]),
    createChoiceOption("English Manga", "meiman", { extern: { type: "meiman" } }, [
      createChoiceOption("IRODORI", "meiman_irodori", {
        extern: { type: "meiman_irodori" },
      }),
      createChoiceOption("FAKKU", "meiman_fakku", {
        extern: { type: "meiman_fakku" },
      }),
      createChoiceOption("18scan", "meiman_18scan", {
        extern: { type: "meiman_18scan" },
      }),
      createChoiceOption("Manhwa", "meiman_manhwa", {
        extern: { type: "meiman_manhwa" },
      }),
      createChoiceOption("Comic", "meiman_comic", {
        extern: { type: "meiman_comic" },
      }),
      createChoiceOption("Other", "meiman_other", {
        extern: { type: "meiman_other" },
      }),
    ]),
    createChoiceOption("Cosplay", "another_cosplay_direct", {
      extern: { type: "another_cosplay" },
    }),
    createChoiceOption("3D", "3D", { extern: { type: "3D" } }),
    createChoiceOption("禁漫汉化组", "jm_translation_team", {
      extern: { type: "禁漫汉化组" },
    }),
  ];
}

function getJmRankingOrderOptions(): RankingFilterOption[] {
  return [
    createChoiceOption("最新", "new", { extern: { order: "new" } }),
    createChoiceOption("最多点赞", "tf", { extern: { order: "tf" } }),
    createChoiceOption("总排行", "mv", { extern: { order: "mv" } }),
    createChoiceOption("月排行", "mv_m", { extern: { order: "mv_m" } }),
    createChoiceOption("周排行", "mv_w", { extern: { order: "mv_w" } }),
    createChoiceOption("日排行", "mv_t", { extern: { order: "mv_t" } }),
  ];
}

function getJmWeekRankingWeekOptions(): RankingFilterOption[] {
  return [
    createChoiceOption("周一", "monday", { core: { date: 1 } }),
    createChoiceOption("周二", "tuesday", { core: { date: 2 } }),
    createChoiceOption("周三", "wednesday", { core: { date: 3 } }),
    createChoiceOption("周四", "thursday", { core: { date: 4 } }),
    createChoiceOption("周五", "friday", { core: { date: 5 } }),
    createChoiceOption("周六", "saturday", { core: { date: 6 } }),
    createChoiceOption("周日", "sunday", { core: { date: 7 } }),
    createChoiceOption("已完结", "completed", { core: { date: 0 } }),
  ];
}

function getJmWeekRankingCategoryOptions(): RankingFilterOption[] {
  return [
    createChoiceOption("全部", "all", { core: { type: "all" } }),
    createChoiceOption("日漫", "manga", { core: { type: "manga" } }),
    createChoiceOption("韩漫", "hanman", { core: { type: "hanman" } }),
  ];
}

function getTimeRankingCategoryOptions(tag: string): RankingFilterOption[] {
  switch (tag) {
    case "hanManTypeMap":
      return [
        createChoiceOption("韩漫", "hanman", { extern: { type: "hanman" } }),
        createChoiceOption("汉化", "hanman_chinese", {
          extern: { type: "hanman_chinese" },
        }),
      ];
    case "qiTaLeiTypeMap":
      return [
        createChoiceOption("其他类", "another", {
          extern: { type: "another" },
        }),
        createChoiceOption("其他漫画", "another_other", {
          extern: { type: "another_other" },
        }),
        createChoiceOption("3D", "another_3d", {
          extern: { type: "another_3d" },
        }),
        createChoiceOption("角色扮演", "another_cosplay", {
          extern: { type: "another_cosplay" },
        }),
      ];
    case "禁漫汉化组":
      return [
        createChoiceOption("禁漫汉化组", "jm_translation_team", {
          extern: { type: "禁漫汉化组" },
        }),
      ];
    default:
      return [
        createChoiceOption("分类", "default", {
          extern: { type: tag || "all" },
        }),
      ];
  }
}

function getTimeRankingOrderOptions(): RankingFilterOption[] {
  return [
    createChoiceOption("最新", "new", { extern: { order: "new" } }),
    createChoiceOption("最多点赞", "tf", { extern: { order: "tf" } }),
    createChoiceOption("总排行", "mv", { extern: { order: "mv" } }),
    createChoiceOption("月排行", "mv_m", { extern: { order: "mv_m" } }),
    createChoiceOption("周排行", "mv_w", { extern: { order: "mv_w" } }),
    createChoiceOption("日排行", "mv_t", { extern: { order: "mv_t" } }),
  ];
}

function getCurrentWeekRankingValue(): string {
  const weekday = new Date().getDay();
  switch (weekday) {
    case 1:
      return "monday";
    case 2:
      return "tuesday";
    case 3:
      return "wednesday";
    case 4:
      return "thursday";
    case 5:
      return "friday";
    case 6:
      return "saturday";
    case 0:
    default:
      return "sunday";
  }
}

async function normalizeHomeSectionTitle(value: unknown): Promise<string> {
  const title = String(value ?? "").trim();
  if (!title) {
    return "";
  }

  const normalizedTitle = String(await opencc.convert(title, "t2s.json")).trim();
  if (normalizedTitle !== "连载更新→右滑看更多→") {
    return normalizedTitle;
  }

  const weekMap = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${weekMap[new Date().getDay()] ?? ""}连载更新`;
}

function sortByToOrder(value: unknown): string {
  const sortBy = Number(value);
  if (sortBy === 2) return "mv";
  if (sortBy === 3) return "mp";
  if (sortBy === 4) return "tf";
  return "";
}

async function loadPluginSetting(key: string, fallback: unknown) {
  const raw = await pluginConfig.load(key, JSON.stringify(fallback));
  try {
    const decoded = JSON.parse(String(raw));
    if (decoded?.ok === true) {
      return decoded.value;
    }
  } catch {
    // noop
  }
  return fallback;
}

/**
 * 旧宿主（< 3.0.34，不懂 getLoginBundle）走 settings 账号密码区登录。
 * 三段比较：4.0.0 > 3.0.34，缺段按 0 补齐。
 */
function compareVersions(a: string, b: string): number {
  // dart.getAppVersion 返回 JSON 编码串（首尾带引号），先剥掉。
  const clean = (v: string) =>
    String(v ?? "")
      .trim()
      .replace(/^"+|"+$/g, "");
  const pa = clean(a)
    .split(".")
    .map((x) => Number(x) || 0);
  const pb = clean(b)
    .split(".")
    .map((x) => Number(x) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function isLegacyHost(): Promise<boolean> {
  const version = await flutterTools.getAppVersion();
  return compareVersions(version, "3.0.34") < 0;
}

async function getSettingsBundle(): Promise<SettingsBundleContract> {
  const [account, password] = await Promise.all([
    loadPluginSetting("auth.account", ""),
    loadPluginSetting("auth.password", ""),
  ]);
  const legacyHost = await isLegacyHost();

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: legacyHost
        ? [
            {
              id: "account",
              title: "账号",
              fields: [
                { key: "auth.account", kind: "text", label: "用户名" },
                { key: "auth.password", kind: "password", label: "密码" },
              ],
            },
          ]
        : [],
    },
    data: {
      canShowUserInfo: true,
      values: legacyHost
        ? {
            "auth.account": String(account ?? ""),
            "auth.password": String(password ?? ""),
          }
        : {},
      canLogin: true,
    },
  };
}

async function getUserInfoBundle(): Promise<UserInfoBundleContract> {
  const ensureUserInfo = async () => {
    const stored = await loadPluginSetting("auth.userInfo", {});
    const current =
      stored && typeof stored === "object"
        ? (stored as Record<string, any>)
        : ({} as Record<string, any>);
    if (String(current.username ?? current.nickname ?? "").trim()) {
      return current;
    }

    const account = String(await loadPluginSetting("auth.account", "")).trim();
    const password = String(await loadPluginSetting("auth.password", "")).trim();
    if (!account || !password) {
      return current;
    }

    const refreshed = (await jmRequest({
      path: `${await getApiBaseUrl()}/login`,
      method: "POST",
      formData: { username: account, password },
      cache: false,
    })) as Record<string, any>;
    await pluginConfig.save("auth.userInfo", JSON.stringify(refreshed));
    return refreshed;
  };

  const user = await ensureUserInfo();

  const username = String(user.username ?? user.nickname ?? "").trim();
  if (!username) {
    throw new Error("未获取到用户信息，请先完成登录或刷新会话");
  }
  const coin = String(user.coin ?? "").trim();
  const level = toNum(user.level, 0);
  const levelName = String(user.level_name ?? user.levelName ?? "").trim();
  const exp = String(user.exp ?? "").trim();
  const nextLevelExp = String(user.nextLevelExp ?? "").trim();
  const photo = String(user.photo ?? "").trim();
  const imageBase = await getImageBaseUrl();

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "userInfo",
    },
    data: {
      title: "账号",
      avatar: {
        id: String(user.uid ?? "me"),
        url: buildJmUserCover(photo, imageBase),
        name: photo,
        path: photo ? (photo.endsWith(".jpg") ? photo : `${photo}.jpg`) : "",
        extern: {
          path: photo ? (photo.endsWith(".jpg") ? photo : `${photo}.jpg`) : "",
        },
      },
      lines: [
        `${username}${coin ? ` (硬币: ${coin})` : ""}`,
        `Lv.${level}${levelName ? ` ${levelName}` : ""}`,
        exp || nextLevelExp ? `经验值: ${exp}/${nextLevelExp}` : "",
      ],
      extern: {
        uid: String(user.uid ?? ""),
      },
    },
  };
}

async function getLoginBundle(): Promise<LoginBundleContract> {
  const account = String(await loadPluginSetting("auth.account", ""));
  const password = String(await loadPluginSetting("auth.password", ""));
  return buildLoginBundle(JM_PLUGIN_ID, {
    title: "禁漫登录",
    fields: [
      { key: "account", kind: "text", label: "用户名" },
      { key: "password", kind: "password", label: "密码" },
    ],
    submitFnPath: "loginWithPassword",
    submitText: "登录",
    values: { account, password },
  });
}

function readLoginFormValues(payload: JmLoginPayload = {}) {
  const record = payload as Record<string, unknown>;
  if (record.values !== undefined) {
    const kitValues = readLoginValues(payload);
    return {
      account: (kitValues.account ?? "").trim(),
      password: kitValues.password ?? "",
    };
  }
  return {
    account: String(record.account ?? "").trim(),
    password: String(record.password ?? ""),
  };
}

async function loginWithPassword(payload: JmLoginPayload = {}): Promise<LoginSubmitResult> {
  const { account, password } = readLoginFormValues(payload);
  if (!account || !password) {
    throw new Error("账号或密码不能为空");
  }

  const path = `${await getApiBaseUrl()}/login`;
  const result = await jmRequest({
    path,
    method: "POST",
    formData: { username: account, password },
  });

  const body = (result ?? {}) as Record<string, unknown>;
  const jwtToken = String(body.jwttoken ?? "");
  await Promise.all([
    pluginConfig.save("auth.account", JSON.stringify(account)),
    pluginConfig.save("auth.password", JSON.stringify(password)),
    pluginConfig.save("auth.userInfo", JSON.stringify(result)),
  ]);

  return {
    source: JM_PLUGIN_ID,
    message: "登录成功",
    data: {
      account,
      password,
      jwtToken,
    },
    raw: result as Record<string, unknown>,
  };
}

let jmInitStarted = false;
let jmAuthFlowRunning = false;

function randomRetryDelayMs() {
  const min = 20_000;
  const max = 300_000;
  return Math.floor(min + Math.random() * (max - min));
}

function waitMs(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** 最近一次选线探针明细, 供 dumpRuntimeInfo 展示. */
let lastEndpointProbes: EndpointProbe[] = [];
let lastImageProbes: ImageProbe[] = [];

type HostTextResult = { url: string; text: string };

async function fetchHostText(url: string): Promise<HostTextResult> {
  const response = await axios.get(url, {
    timeout: HOSTCFG_TIMEOUT_MS,
    responseType: "text",
    validateStatus: () => true,
  });
  const status = Number(response.status || 0);
  if (status < 200 || status >= 300) {
    throw new Error(`status=${status} url=${url}`);
  }
  return { url, text: String(response.data ?? "") };
}

/** host 配置双 URL 并发取, 先到先用, 慢路不阻塞. */
async function loadHostPool(): Promise<string[]> {
  const results = await Promise.allSettled(
    Config.JM_HOST_CONFIG_URLS.map((url) => fetchHostText(url)),
  );
  const fulfilled = results.find(
    (result): result is PromiseFulfilledResult<HostTextResult> =>
      result.status === "fulfilled" && Boolean(result.value.text.trim()),
  );
  if (!fulfilled) {
    const firstError = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    throw firstError?.reason ?? new Error("host config urls unavailable");
  }
  const normalized = fulfilled.value.text.replace(/[^A-Za-z0-9+/=]/g, "");
  const key = await md5Hex(Config.JM_HOSTCFG_AES_SEED);
  const decrypted = await hostRuntime.crypto.aesEcbPkcs7Decrypt(bytesFromBase64(normalized), key);
  const plain = new TextDecoder("utf-8").decode(decrypted);
  const parsed = JSON.parse(String(plain || "{}")) as { Server?: unknown };
  if (!Array.isArray(parsed.Server)) {
    return [];
  }
  return parsed.Server.map((item) => normalizeBaseUrl(item)).filter(Boolean);
}

/** 全池 setting 探针选线: 返回按 ok < degraded < dead、延迟排序的可用池. */
async function resolveOrderedPool(hostPool: string[]) {
  const probes = await probeAll(hostPool, {
    timeoutMs: PROBE_TIMEOUT_MS,
    concurrency: PROBE_CONCURRENCY,
  });
  lastEndpointProbes = probes;
  return orderPool(probes);
}

/**
 * 图床选优: 从各线路 setting 解出的 img_host 去重, 逐个打轻量探针排序.
 * setting 无 img_host 时回退 fallback, 保证图床恒有值.
 */
async function resolveImagePool(probes: EndpointProbe[], fallback: string): Promise<string[]> {
  const candidates = Array.from(
    new Set(
      probes
        .map((probe) => probe.setting?.img_host)
        .map((host) => (typeof host === "string" ? normalizeBaseUrl(host) : ""))
        .filter(Boolean),
    ),
  );
  if (candidates.length === 0) {
    return [fallback || Config.JM_FALLBACK_IMAGE_BASE];
  }
  const results: ImageProbe[] = [];
  const queue = [...candidates];
  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const candidate = queue.shift()!;
      results.push(await probeImageHost(candidate, PROBE_TIMEOUT_MS));
    }
  });
  await Promise.all(workers);
  lastImageProbes = results;
  const ordered = orderImagePool(results);
  return ordered.length > 0 ? ordered : [fallback || Config.JM_FALLBACK_IMAGE_BASE];
}

async function applyOrderedPool(
  ordered: string[],
  imagePool: string[],
  hostPool: string[],
): Promise<string> {
  const pool =
    ordered.length > 0
      ? ordered
      : [normalizeBaseUrl(hostPool[0] ?? "") || Config.JM_FALLBACK_API_BASE];
  const apiBaseUrl = pool[0]!;
  const image = imagePool[0] ?? Config.JM_FALLBACK_IMAGE_BASE;
  await setRuntimeEndpointCache({
    apiBaseUrl,
    imageBaseUrl: image,
    imagePool,
    hostPool: pool,
  });
  return apiBaseUrl;
}

async function resolveFastestBases() {
  const cached = await getRuntimeEndpointCache();
  if (cached) {
    return { data: cached.apiBaseUrl };
  }

  let data = Config.JM_FALLBACK_API_BASE;
  const imageCandidate = Config.JM_FALLBACK_IMAGE_BASE;
  let hostPool: string[] = [];
  try {
    hostPool = await loadHostPool();
  } catch (error) {
    console.warn("[jm.init] load host pool failed", error);
  }
  if (hostPool.length === 0) {
    hostPool = [Config.JM_FALLBACK_API_BASE];
  }

  try {
    const { ordered, probes } = await resolveOrderedPool(hostPool);
    if (ordered.length === 0) {
      data = await applyOrderedPool([], [imageCandidate], hostPool);
    } else {
      const imagePool = await resolveImagePool(probes, imageCandidate);
      data = await applyOrderedPool(ordered, imagePool, hostPool);
    }
  } catch (error) {
    console.warn("[jm.init] probe setting endpoints failed", error);
    data = await applyOrderedPool([], [imageCandidate], hostPool);
  }

  return { data };
}

async function tryJmCheckin() {
  const stored = await loadPluginSetting("auth.userInfo", {});
  const uid = stored?.uid;
  if (!uid) {
    console.error("无法获取用户UID，跳过签到");
    return false;
  }

  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const dailyListRes = await jmRequest({
        url: `${await getApiBaseUrl()}/daily_list/filter`,
        method: "POST",
        formData: {
          data: String(new Date().getFullYear()),
        },
      });

      const list = dailyListRes?.data?.list ?? dailyListRes?.list ?? [];
      if (!Array.isArray(list) || list.length === 0) {
        console.log("今日无签到项");
        return true;
      }

      const lastItem = list[list.length - 1];
      const dailyId = lastItem?.id;
      if (!dailyId) {
        throw new Error("无法获取 dailyId");
      }

      const chkRes = await jmRequest({
        url: `${await getApiBaseUrl()}/daily_chk`,
        method: "POST",
        formData: {
          user_id: uid,
          daily_id: dailyId,
        },
      });

      let msg = String(chkRes?.data?.msg ?? chkRes?.msg ?? "");

      msg = await opencc.convert(msg, "t2s.json");

      if (msg !== "今天已经签到过了") {
        try {
          flutterTools.showToast({
            message: "禁漫自动签到成功！",
            level: "success",
          });
        } catch {}
      }

      return true;
    } catch (error) {
      console.error("签到出错", error);
      retryCount++;
      if (retryCount > maxRetries) {
        console.error("禁漫签到失败");
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return false;
}

async function runJmAuthAndCheckInLoop() {
  if (jmAuthFlowRunning) {
    return;
  }
  jmAuthFlowRunning = true;
  try {
    while (true) {
      try {
        const account = String(await loadPluginSetting("auth.account", "")).trim();
        const password = String(await loadPluginSetting("auth.password", ""));

        if (!account || !password) {
          console.info("[jm.init] skip auth/checkin: no credentials");
          return;
        }

        const data = await loginWithPassword({
          account,
          password,
          path: `${await getApiBaseUrl()}/login`,
        });

        console.info(data);

        const checkedIn = await tryJmCheckin();
        if (!checkedIn) {
          throw new Error("checkin failed");
        }

        console.info("[jm.init] login + checkin ok");
        return;
      } catch (error) {
        const delay = randomRetryDelayMs();
        console.warn(`[jm.init] login/checkin failed, retry in ${delay}ms`, error);
        await waitMs(delay);
      }
    }
  } finally {
    jmAuthFlowRunning = false;
  }
}
async function init(): Promise<{ source: string; data: Record<string, unknown> }> {
  console.debug("init");
  await resolveFastestBases();
  if (!jmInitStarted) {
    jmInitStarted = true;
    void runJmAuthAndCheckInLoop();
  }

  const endpoints = await getEndpoints();
  return {
    source: JM_PLUGIN_ID,
    data: {
      ok: true,
      started: true,
      runtimeImageBaseUrl: endpoints.imageBaseUrl,
      fastestApiBase: endpoints.apiBaseUrl,
    },
  };
}

async function getCapabilitiesBundle(): Promise<CapabilitiesBundleContract> {
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "capabilities" as const,
      actions: [
        {
          key: "clear_session",
          title: "清理插件会话",
          fnPath: "clearPluginSession",
        },
      ],
    },
    data: {
      actions: ["clear_session"],
    },
  };
}

function buildJmRankingScene() {
  return buildComicListScene({
    title: "禁漫排行榜",
    list: {
      fnPath: "getRankingData",
      extern: { source: "ranking" },
    },
    filter: {
      fnPath: "getRankingFilterBundle",
      extern: { source: "ranking" },
    },
  });
}

function buildJmLatestScene() {
  return buildComicListScene({
    title: "最新",
    list: {
      fnPath: "getLatestData",
      extern: { source: "latest" },
    },
  });
}

async function getCloudFavoriteFilterBundle(
  payload: JmCloudFavoritePayload = {},
): Promise<FilterBundleContract> {
  const extern = toStringMap(payload.extern);
  const path = `${await getApiBaseUrl()}/favorite`;
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page: 1, folder_id: "", o: "mr" },
    cache: false,
  })) as Record<string, any>;

  const folderList = Array.isArray(raw.folder_list) ? raw.folder_list : [];
  const folderOptions = [
    {
      label: "默认",
      value: "",
      result: { extern: { folderId: "" } },
    },
    ...folderList.map((item: any) => ({
      label: String(item?.name ?? ""),
      value: String(item?.FID ?? ""),
      result: { extern: { folderId: String(item?.FID ?? "") } },
    })),
  ];

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0" as const,
      type: "rankingFilter" as const,
      title: "云端收藏筛选",
      fields: [
        {
          key: "folderId",
          kind: "choice",
          label: "收藏夹",
          options: folderOptions,
        },
        {
          key: "order",
          kind: "choice",
          label: "排序",
          options: [
            {
              label: "收藏时间",
              value: "mr",
              result: { extern: { order: "mr" } },
            },
            {
              label: "更新时间",
              value: "mp",
              result: { extern: { order: "mp" } },
            },
          ],
        },
      ],
    },
    data: {
      values: {
        folderId: String(extern.folderId ?? ""),
        order: String(extern.order ?? "mr"),
      },
    },
  };
}

async function getCloudFavoriteSceneBundle(): Promise<ComicListSceneBundleContract> {
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "comicListSceneBundle",
    },
    data: {
      scene: buildJmCloudFavoriteScene(),
    },
  };
}

async function getInfo(): Promise<InfoContract> {
  return buildPluginInfo({
    buildLatestScene: buildJmLatestScene,
    buildRankingScene: buildJmRankingScene,
  }) as InfoContract;
}

async function getFunctionPage(
  payload: GetFunctionPagePayload = {},
): Promise<FunctionPageContract> {
  const core = toStringMap(payload.core);
  const id = String(payload.id ?? core.id ?? "").trim();
  if (id !== "recommend") {
    throw new Error(`未知功能: ${id}`);
  }

  const recommend = await getHomeRecommendData();
  console.log(
    JSON.stringify(recommend, (key, value) =>
      key === "items" || key === "raw" ? undefined : value,
    ),
  );
  const sections = Array.isArray((recommend as any)?.data?.sections)
    ? (recommend as any).data.sections
    : [];

  const pickedSections = sections
    .filter((section: any) => {
      const title = String(section?.title ?? "").trim();
      return title !== "禁漫小說" && title !== "禁漫書庫";
    })
    .map((section: any) => ({
      id: String(section?.id ?? ""),
      title: String(section?.title ?? ""),
      subtitle: String(section?.subtitle ?? ""),
      action: toStringMap(section?.action),
      body: {
        type: "comic-list",
        direction: "horizontal",
        key: "items",
      },
      items: Array.isArray(section?.items) ? section.items : [],
      raw: section?.raw ?? section,
    }));

  console.log(
    JSON.stringify(pickedSections, (key, value) =>
      key === "items" || key === "raw" ? undefined : value,
    ),
  );

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "page",
      title: "推荐",
      body: {
        type: "list" as const,
        children: [{ type: "comic-section-list" as const, key: "sections" }],
      },
    },
    data: {
      sections: pickedSections,
      hasReachedMax: true,
    },
  };
}

async function getComicListSceneBundle(): Promise<ComicListSceneBundleContract> {
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "comicListSceneBundle",
    },
    data: {
      scene: buildComicListScene({
        title: "禁漫排行榜",
        list: {
          fnPath: "getRankingData",
          extern: { source: "ranking" },
        },
        filter: {
          fnPath: "getRankingFilterBundle",
          extern: { source: "ranking" },
        },
      }) as any,
    },
  };
}

async function getRankingFilterBundle(): Promise<FilterBundleContract> {
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "rankingFilter",
      title: "筛选漫画",
      fields: [
        {
          key: "category",
          kind: "choice",
          label: "分类",
          options: getJmRankingCategoryOptions(),
        },
        {
          key: "order",
          kind: "choice",
          label: "排序",
          options: getJmRankingOrderOptions(),
        },
      ],
    },
    data: {
      values: {
        category: "latest",
        order: "new",
      },
    },
  };
}

/** 禁漫 /search 每页固定条数. */
const JM_SEARCH_PAGE_SIZE = 80;
/** 标签组合搜索: 并发拉分页的并发数(实测 JM 每请求约 450ms, 并发 24 吞吐不降). */
const JM_TAG_PAGE_CONCURRENCY = 24;
/** 标签组合搜索: 并发核对本子详情的并发数. */
const JM_TAG_DETAIL_CONCURRENCY = 24;
/** 标签组合搜索: 每个条件词首次拉取的条数(由页预算动态算, 这里只是兜底). */
const JM_TAG_TERM_BUDGET = 8 * JM_SEARCH_PAGE_SIZE;
/** 标签组合搜索: 多条件时总请求数预算(32 个请求 ≈ 1~2 秒). */
const JM_TAG_PAGE_BUDGET_TOTAL = 32;
/** 标签组合搜索: 翻页时每个条件词再加深多少条. */
const JM_TAG_GROW_STEP = 8 * JM_SEARCH_PAGE_SIZE;
/** 标签组合搜索: 每个条件词最多拉多少条. */
const JM_TAG_MAX_BUDGET = 40 * JM_SEARCH_PAGE_SIZE;
/** 标签组合搜索: 一页最多核对多少本子的详情. */
const JM_TAG_VERIFY_BATCH = 48;

type TagTerm = { text: string; mainTag: 0 | 3 };

type TagSearchPlan = {
  /** 查询指纹, 变了就从头开始 */
  key: string;
  terms: TagTerm[];
  /** 每个检索词拉取的条数上限 */
  budget: number;
  /** 已经吐给上层的本子 id, 用来避免翻页重复 */
  seen: string[];
};

type SearchTermList = {
  items: any[];
  total: number;
  /** 服务端已经翻到最后一页 */
  exhausted: boolean;
};

type TagQuery = {
  /** AND 条件词 */
  terms: string[];
  /** 来自高级搜索勾选的标签(用来判断能否回退到普通搜索) */
  picked: string[];
  /** 分类 slug, 对应搜索接口的 c 参数 */
  category: string;
};

let tagTaxonomy: JmTagTaxonomy | null = null;
let tagTaxonomyPromise: Promise<JmTagTaxonomy> | null = null;
let knownTagIndex: { normalized: Set<string> } | null = null;
const termListCache = new Map<string, SearchTermList>();
const albumMetaCache = new Map<string, AlbumSearchFields>();
const tagSimplifyCache = new Map<string, string>();
/** 本子是否满足全部条件的核对结果(按 id 缓存), 翻页不用重复拉详情 */
const tagVerdicts = new Map<string, boolean>();

/** 同步归一化(不含繁简转换). */
function syncNormalize(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** 繁简统一, 带缓存(本子标签词表很小, 命中率很高). */
async function simplifyTagText(value: string): Promise<string> {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  const hit = tagSimplifyCache.get(raw);
  if (hit !== undefined) {
    return hit;
  }
  let out = raw;
  try {
    out = String(await opencc.convert(raw, "t2s.json")).trim();
  } catch {
    out = raw;
  }
  tagSimplifyCache.set(raw, out);
  return out;
}

/** 标签体系(来自禁漫 /categories), 进程内缓存. */
async function loadTagTaxonomy(): Promise<JmTagTaxonomy> {
  if (tagTaxonomy) {
    return tagTaxonomy;
  }
  if (!tagTaxonomyPromise) {
    tagTaxonomyPromise = (async () => {
      try {
        const response = await jmRequest({
          path: `${await getApiBaseUrl()}/categories`,
          method: "GET",
        });
        const taxonomy = parseTagTaxonomy(response);
        if (taxonomy.tags.length > 0) {
          tagTaxonomy = taxonomy;
          knownTagIndex = null;
        }
        return taxonomy;
      } catch (err) {
        console.warn("[jm] 加载标签体系失败", err);
        return tagTaxonomy ?? { groups: [], tags: [], categories: [] };
      } finally {
        tagTaxonomyPromise = null;
      }
    })();
  }
  return tagTaxonomyPromise;
}

/** 已知标签索引: 官方主题标签 + 常用标签, 用来判断一个词该不该按标签检索. */
async function loadKnownTagIndex(): Promise<{ normalized: Set<string> }> {
  if (knownTagIndex) {
    return knownTagIndex;
  }
  const taxonomy = await loadTagTaxonomy();
  const normalized = new Set<string>();
  for (const tag of [...taxonomy.tags, ...JM_COMMON_TAGS]) {
    normalized.add(syncNormalize(await simplifyTagText(tag)));
  }
  knownTagIndex = { normalized };
  return knownTagIndex;
}

/**
 * 常用标签选项(去重掉官方主题标签里已有的).
 *
 * 去重要跨简繁: 禁漫的 /categories 节点有时回繁体(劇情向), 有时回简体(剧情向),
 * 直接比字符串会漏掉一半的重叠, 常用标签列表就会多出一堆重复项.
 */
let commonTagOptionsCache: { label: string; value: string }[] | null = null;

async function loadCommonTagOptions(): Promise<{ label: string; value: string }[]> {
  if (commonTagOptionsCache) {
    return commonTagOptionsCache;
  }
  const taxonomy = await loadTagTaxonomy();
  const themeTags = new Set<string>();
  for (const tag of taxonomy.tags) {
    themeTags.add(syncNormalize(await simplifyTagText(tag)));
  }

  const options: { label: string; value: string }[] = [];
  for (const tag of JM_COMMON_TAGS) {
    if (themeTags.has(syncNormalize(await simplifyTagText(tag)))) {
      continue;
    }
    options.push({ label: tag, value: tag });
  }

  commonTagOptionsCache = options;
  return options;
}

/** 拉某个检索词的结果集(按页并发拉, 进程内缓存). */
async function loadSearchTermList(
  term: TagTerm,
  budget: number,
  category: string,
  order: string,
): Promise<SearchTermList> {
  const key = `${term.mainTag}:${term.text}:${category}:${order}`;
  let entry = termListCache.get(key);
  if (!entry) {
    entry = { items: [], total: 0, exhausted: false };
    termListCache.set(key, entry);
  }
  if (entry.exhausted || entry.items.length >= budget) {
    return entry;
  }

  const startPage = Math.floor(entry.items.length / JM_SEARCH_PAGE_SIZE) + 1;
  const need = Math.ceil((budget - entry.items.length) / JM_SEARCH_PAGE_SIZE);
  const pageNumbers: number[] = [];
  for (let i = 0; i < need; i++) {
    pageNumbers.push(startPage + i);
  }

  const responses = await mapWithConcurrency(
    pageNumbers,
    JM_TAG_PAGE_CONCURRENCY,
    async (page) => {
      const params: Record<string, unknown> = {
        search_query: term.text,
        page,
        o: order,
      };
      if (term.mainTag !== 0) {
        params.main_tag = term.mainTag;
      }
      if (category) {
        params.c = category;
      }
      try {
        const response = (await jmRequest({
          path: `${await getApiBaseUrl()}/search`,
          method: "GET",
          params,
        })) as Record<string, any>;
        return response;
      } catch (err) {
        // 单页失败就少这一页, 别让整次搜索报错
        console.warn("[jm] 拉搜索页失败", term.text, page, err);
        return null;
      }
    },
  );

  for (const response of responses) {
    if (!response) {
      continue;
    }
    const content = Array.isArray(response?.content) ? response.content : [];
    entry.total = Math.max(entry.total, toNum(response?.total, 0));
    if (content.length === 0) {
      entry.exhausted = true;
      continue;
    }
    entry.items.push(...content);
    if (content.length < JM_SEARCH_PAGE_SIZE) {
      entry.exhausted = true;
    }
  }

  return entry;
}

/** 本子详情(标题/作者/标签/作品/角色), 进程内缓存, 字段已统一成简体. */
async function fetchAlbumMeta(comicId: string): Promise<AlbumSearchFields> {
  const id = String(comicId ?? "").trim();
  if (!id) {
    return {};
  }
  const hit = albumMetaCache.get(id);
  if (hit) {
    return hit;
  }
  const response = (await jmRequest({
    path: `${await getApiBaseUrl()}/album`,
    method: "GET",
    params: { id },
  })) as Record<string, any>;
  const meta: AlbumSearchFields = {
    name: await simplifyTagText(String(response?.name ?? "")),
    author: await Promise.all(toStrList(response?.author).map(simplifyTagText)),
    tags: await Promise.all(toStrList(response?.tags).map(simplifyTagText)),
    works: await Promise.all(toStrList(response?.works).map(simplifyTagText)),
    actors: await Promise.all(toStrList(response?.actors).map(simplifyTagText)),
  };
  albumMetaCache.set(id, meta);
  return meta;
}

/** 判定这次搜索是不是"多条件"模式, 是的话给出条件词与分类. */
async function resolveTagQuery(
  extern: Record<string, unknown>,
  keyword: string,
): Promise<TagQuery | null> {
  // 高级搜索里所有 tags 开头的字段都是勾选出来的条件
  const picked: string[] = [];
  for (const [key, value] of Object.entries(extern)) {
    if (!key.startsWith("tags")) {
      continue;
    }
    for (const item of toStrList(value)) {
      if (item && !picked.includes(item)) {
        picked.push(item);
      }
    }
  }

  const terms: string[] = [];
  for (const term of [...picked, ...splitTagTerms(keyword)]) {
    const value = String(term ?? "").trim();
    if (value && !terms.includes(value)) {
      terms.push(value);
    }
  }
  if (!terms.length) {
    return null;
  }

  return {
    terms,
    picked,
    category: String(extern.category ?? "").trim(),
  };
}

/** 逐本核对: 本子是否同时满足所有条件词. 结果按 id 缓存, 翻页不重复核对. */
async function filterByTagRules(
  candidates: any[],
  terms: string[],
  verdicts: Map<string, boolean>,
): Promise<any[]> {
  if (!candidates.length) {
    return [];
  }

  // 只核对这一页要用的那批, 剩下的留给下一页(不然候选一多就慢到没法用)
  const pending = candidates.filter(
    (item) => !verdicts.has(String(item?.id ?? "")),
  );
  const batch = pending.slice(0, JM_TAG_VERIFY_BATCH);
  if (batch.length > 0) {
    const metas = await mapWithConcurrency(
      batch,
      JM_TAG_DETAIL_CONCURRENCY,
      async (item) => {
        try {
          return await fetchAlbumMeta(String(item?.id ?? ""));
        } catch (err) {
          console.warn("[jm] 拉本子详情失败", err);
          return null;
        }
      },
    );

    for (let i = 0; i < batch.length; i++) {
      const id = String(batch[i]?.id ?? "");
      const meta = metas[i];
      if (!id || !meta) {
        continue;
      }
      verdicts.set(
        id,
        terms.every((term) => albumMatchesTerm(meta, term, syncNormalize)),
      );
    }
  }

  return candidates.filter((item) => verdicts.get(String(item?.id ?? "")) === true);
}

function toTagSearchPlan(value: unknown): TagSearchPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const key = String(record.key ?? "");
  const terms = Array.isArray(record.terms) ? record.terms : [];
  if (!key || !terms.length) {
    return null;
  }
  const parsedTerms: TagTerm[] = [];
  for (const item of terms) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const term = item as Record<string, unknown>;
    const text = String(term.text ?? "").trim();
    if (!text) {
      continue;
    }
    parsedTerms.push({
      text,
      mainTag: toNum(term.mainTag, 0) === 3 ? 3 : 0,
    });
  }
  if (!parsedTerms.length) {
    return null;
  }
  return {
    key,
    terms: parsedTerms,
    budget: Math.max(JM_SEARCH_PAGE_SIZE, toNum(record.budget, JM_TAG_TERM_BUDGET)),
    seen: Array.isArray(record.seen) ? record.seen.map((id) => String(id)) : [],
  };
}

async function getAdvancedSearchScheme(
  payload: { extern?: Record<string, unknown> } = {},
): Promise<AdvancedSearchContract> {
  const extern = toStringMap(payload.extern);
  const taxonomy = await loadTagTaxonomy();
  const categoryOptions = [
    { label: "全部", value: "" },
    ...taxonomy.categories.map((item) => ({ label: item.label, value: item.value })),
  ];

  // 标签分成多组多选, 免得一个下拉里塞一百多项
  const tagFields = taxonomy.groups.map((group, index) => ({
    key: `tags_group_${index + 1}`,
    kind: "multiChoice" as const,
    label: group.title,
    options: group.tags.map((tag) => ({ label: tag, value: tag })),
  }));

  const commonTags = await loadCommonTagOptions();

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "advancedSearch",
      fields: [
        {
          key: "sortBy",
          kind: "choice",
          label: "排序",
          options: [
            { label: "从新到旧", value: 1 },
            { label: "最多观看", value: 2 },
            { label: "最多图片", value: 3 },
            { label: "最多点赞", value: 4 },
          ],
        },
        {
          key: "category",
          kind: "choice",
          label: "分类",
          options: categoryOptions,
        },
        ...tagFields,
        {
          key: "tags_common",
          kind: "multiChoice",
          label: "常用标签",
          options: commonTags,
        },
      ],
    },
    data: {
      values: {
        sortBy: toNum(extern.sortBy, 1),
        category: String(extern.category ?? ""),
      },
    },
  };
}

async function getWeekRankingFilterBundle(): Promise<FilterBundleContract> {
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "weekRankingFilter",
      title: "筛选更新",
      fields: [
        {
          key: "week",
          kind: "choice",
          label: "星期",
          options: getJmWeekRankingWeekOptions(),
        },
        {
          key: "category",
          kind: "choice",
          label: "分类",
          options: getJmWeekRankingCategoryOptions(),
        },
      ],
    },
    data: {
      values: {
        week: getCurrentWeekRankingValue(),
        category: "all",
      },
    },
  };
}

async function getTimeRankingFilterBundle(
  payload: { tag?: string; core?: Record<string, unknown> } = {},
): Promise<FilterBundleContract> {
  const core = toStringMap(payload.core);
  const tag = String(payload.tag ?? core.tag ?? "").trim();
  const categoryOptions = getTimeRankingCategoryOptions(tag);
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "timeRankingFilter",
      title: "筛选排行榜",
      fields: [
        {
          key: "order",
          kind: "choice",
          label: "排序",
          options: getTimeRankingOrderOptions(),
        },
        {
          key: "category",
          kind: "choice",
          label: "分类",
          options: categoryOptions,
        },
      ],
    },
    data: {
      values: {
        order: "new",
        category: categoryOptions[0]?.value ?? "",
      },
    },
  };
}

async function clearPluginSession(): Promise<{ ok: boolean; message: string }> {
  await Promise.all([
    pluginConfig.save("auth.account", JSON.stringify("")),
    pluginConfig.save("auth.password", JSON.stringify("")),
    pluginConfig.save("auth.userInfo", JSON.stringify({})),
    clearRuntimeEndpointCache(),
  ]);

  return {
    ok: true,
    message: "jm 插件会话已清理",
  };
}

async function dumpRuntimeInfo(): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const probes = lastEndpointProbes.map((probe) => {
    const outcome = probe.outcome;
    return {
      baseUrl: probe.baseUrl,
      status: outcome.status,
      latencyMs: outcome.status === "dead" ? null : outcome.latencyMs,
      httpStatus: outcome.status === "degraded" ? outcome.httpStatus : null,
      reason: outcome.status === "dead" ? outcome.reason : null,
    };
  });
  const imageProbes = lastImageProbes.map((probe) => {
    const outcome = probe.outcome;
    return {
      baseUrl: probe.baseUrl,
      status: outcome.status,
      latencyMs: outcome.status === "dead" ? null : outcome.latencyMs,
      httpStatus: outcome.status === "degraded" ? outcome.httpStatus : null,
      reason: outcome.status === "dead" ? outcome.reason : null,
    };
  });
  const endpoints = await getEndpoints();
  return {
    ok: true,
    data: {
      pluginName: "jmComic",
      now: new Date().toISOString(),
      apiBaseUrl: endpoints.apiBaseUrl,
      imageBaseUrl: endpoints.imageBaseUrl,
      apiPool: [...endpoints.hostPool],
      imagePool: [...endpoints.imagePool],
      probeTimeoutMs: PROBE_TIMEOUT_MS,
      probes,
      imageProbes,
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

async function getComicDetail(payload: ComicDetailPayload = {}): Promise<ComicDetailContract> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const path = `${await getApiBaseUrl()}/album`;
  const imageBase = await getImageBaseUrl();

  const response = (await jmRequest({
    path,
    method: "GET",
    params: { id: comicId },
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

  const normal: ComicDetailNormal = {
    comicInfo: {
      id: String(normalizedInfo.id),
      title: normalizedInfo.name,
      titleMeta: [
        createActionItem(`浏览：${toNum(normalizedInfo.total_views)}`),
        createActionItem(`更新时间：${timestampToIso(normalizedInfo.addtime)}`),
        createActionItem(
          `章节数：${normalizedInfo.series.length > 0 ? normalizedInfo.series.length : 1}`,
        ),
        createActionItem(`总页数：${toNum(response.total_photos)}`),
        createActionItem(`禁漫车：jm${normalizedInfo.id}`),
      ],
      creator: {
        id: "",
        name: "",
        avatar: createImage({
          id: "",
          url: "",
          name: "",
        }),
        onTap: { type: "openSearch", payload: {} },
        extern: {},
      },
      description: normalizedInfo.description,
      cover: createImage({
        id: String(normalizedInfo.id),
        url: resolveJmCoverUrl(normalizedInfo, imageBase),
        path: `${normalizedInfo.id}.jpg`,
        extern: {},
      }),
      metadata: [
        createMetadataActionList("author", "作者", normalizedInfo.author, (item) =>
          createActionItem(item, openSearchAction({ source: JM_PLUGIN_ID, keyword: item })),
        ),
        createMetadataActionList("tags", "标签", normalizedInfo.tags, (item) =>
          createActionItem(item, openSearchAction({ source: JM_PLUGIN_ID, keyword: item })),
        ),
        createMetadataActionList("works", "作品", normalizedInfo.works, (item) =>
          createActionItem(item, openSearchAction({ source: JM_PLUGIN_ID, keyword: item })),
        ),
        createMetadataActionList("actors", "角色", normalizedInfo.actors, (item) =>
          createActionItem(item, openSearchAction({ source: JM_PLUGIN_ID, keyword: item })),
        ),
      ].filter((item): item is NonNullable<typeof item> => item != null),
      extern: {},
    },
    eps: (() => {
      const mapped = normalizedInfo.series.map((item: any) => ({
        id: String(item?.id ?? ""),
        requestId: String(item?.id ?? ""),
        logicalKey: String(item?.id ?? ""),
        storageChapterId: String(item?.id ?? ""),
        name: String(item?.name ?? ""),
        order: toNum(item?.order, 0),
        extern: {
          sort: toNum(item?.rawOrder, toNum(item?.sort, 0)),
        },
      }));

      if (mapped.length > 0) {
        return mapped;
      }

      return [
        {
          id: String(normalizedInfo.id),
          requestId: String(normalizedInfo.id),
          logicalKey: String(normalizedInfo.id),
          storageChapterId: String(normalizedInfo.id),
          name: "第1话",
          order: 1,
          extern: {
            sort: 1,
          },
        },
      ];
    })(),
    recommend: (normalizedInfo.related_list as any[]).map((item: any): RecommendItem => {
      const unifiedItem = toComicItem(item, imageBase);
      return {
        source: JM_PLUGIN_ID,
        id: unifiedItem.id,
        title: unifiedItem.title,
        subtitle: unifiedItem.subtitle,
        finished: unifiedItem.finished,
        likesCount: unifiedItem.likesCount,
        viewsCount: unifiedItem.viewsCount,
        updatedAt: unifiedItem.updatedAt,
        cover: createImage({
          id: unifiedItem.id,
          url: resolveJmCoverUrl(item, imageBase),
          path: `${unifiedItem.id}.jpg`,
          extern: {},
        }),
        metadata: unifiedItem.metadata,
        raw: unifiedItem.raw,
        extern: {},
      };
    }),
    totalViews: toNum(normalizedInfo.total_views),
    totalLikes: toNum(normalizedInfo.likes),
    totalComments: toNum(normalizedInfo.comment_total),
    isFavourite: toBool(normalizedInfo.is_favorite),
    isLiked: toBool(normalizedInfo.liked),
    allowComments: true,
    allowLike: true,
    allowCollected: true,
    allowDownload: true,
    extern: {},
  };

  const scheme = {
    version: "1.0.0" as const,
    type: "comicDetail" as const,
    source: JM_PLUGIN_ID,
  };

  const data: ComicDetailData = {
    normal,
    raw: {
      comicInfo: normalizedInfo,
    },
  };

  return {
    source: JM_PLUGIN_ID,
    comicId,
    extern: payload.extern ?? null,
    scheme,
    data,
  };
}
type SearchResultBuilder = (
  content: any[],
  total: number,
  override?: { hasReachedMax?: boolean; extern?: Record<string, unknown> },
) => SearchResultContract;

/**
 * 多条件(标签组合)搜索.
 *
 * 禁漫服务端没有多条件过滤能力, 所以这里做的是:
 * 1. 每个条件词各拉一份结果集(标签词走 main_tag=3 走标签字段, 其它词走站内搜索);
 * 2. 结果集求交集 —— 交集里的本子必然同时命中所有条件;
 * 3. 逐本核对详情兜底(标签名带后缀时"互相包含"才认);
 * 4. 交集不够就把检索词的前缀拉得更长, 直到拉完或翻满上限.
 */
async function runTagSearch(input: {
  query: TagQuery;
  extern: Record<string, unknown>;
  page: number;
  order: string;
  build: SearchResultBuilder;
}): Promise<SearchResultContract | null> {
  const { query, extern, page, order, build } = input;
  const index = await loadKnownTagIndex();
  // 条件词统一成简体再检索/核对: 禁漫的标签有时简体有时繁体
  const conditionTerms = await Promise.all(
    query.terms.map((term) => simplifyTagText(resolveTagQueryTerm(term))),
  );

  const terms: TagTerm[] = query.terms.map((_, i) => ({
    text: conditionTerms[i] ?? "",
    // 词在标签表里就按标签字段检索(main_tag=3), 否则走站内搜索
    mainTag: index.normalized.has(syncNormalize(conditionTerms[i] ?? "")) ? 3 : 0,
  }));

  const planKey = JSON.stringify({
    terms: terms.map((term) => [term.text, term.mainTag]),
    category: query.category,
  });

  let plan = toTagSearchPlan(extern.tagSearch);
  if (!plan || plan.key !== planKey) {
    plan = { key: planKey, terms, budget: 0, seen: [] };
  }
  if (page <= 1) {
    plan.seen = [];
  }
  const seen = new Set(plan.seen);

  // 单条件就是普通搜索: 走标签字段更准, 速度跟原来一样(一个请求一页)
  if (terms.length === 1) {
    const only = terms[0]!;
    const response = (await jmRequest({
      path: `${await getApiBaseUrl()}/search`,
      method: "GET",
      params: {
        search_query: only.text,
        page,
        o: order,
        ...(only.mainTag === 3 ? { main_tag: 3 } : {}),
        ...(query.category ? { c: query.category } : {}),
      },
    })) as Record<string, any>;
    const content = Array.isArray(response?.content) ? response.content : [];
    return build(content, toNum(response?.total, content.length));
  }

  // 页预算: 条件越多每个条件分到的页越少, 总请求数控制在 32 个左右.
  // 一次并发拉完(分多轮拉会叠加每轮的延迟), 翻页时再逐步加深.
  const pagesPerTerm = Math.max(
    6,
    Math.floor(JM_TAG_PAGE_BUDGET_TOTAL / terms.length),
  );
  const targetBudget = pagesPerTerm * JM_SEARCH_PAGE_SIZE;
  plan.budget =
    page <= 1
      ? targetBudget
      : Math.min(plan.budget + JM_TAG_GROW_STEP, JM_TAG_MAX_BUDGET);

  // 全部条件都是标签词时, 服务端已经按标签字段检索过了, 交集本身就是"同时带这些标签",
  // 不用再逐本拉详情核对(那一步最贵). 有普通关键词时才核对, 保证关键词也真的命中.
  const needVerify = terms.some((term) => term.mainTag !== 3);

  const lists = await Promise.all(
    terms.map(async (term) => {
      const list = await loadSearchTermList(
        term,
        plan.budget,
        query.category,
        order,
      );
      if (list.items.length > 0 || term.mainTag !== 3) {
        return list;
      }
      // 标签字段里没有这个词, 退回站内搜索再试一次
      return loadSearchTermList(
        { text: term.text, mainTag: 0 },
        plan.budget,
        query.category,
        order,
      );
    }),
  );
  const exhausted = lists.every((list) => list.exhausted);

  const idLists = lists.map((list) =>
    list.items.map((item) => String(item?.id ?? "")).filter((id) => id.length > 0),
  );
  const interIds = intersectIdLists(idLists);

  const itemById = new Map<string, any>();
  for (const list of lists) {
    for (const item of list.items) {
      const id = String(item?.id ?? "");
      if (id && !itemById.has(id)) {
        itemById.set(id, item);
      }
    }
  }

  const candidates = interIds
    .map((id) => itemById.get(id))
    .filter((item) => Boolean(item));
  const unseen = candidates.filter((item) => !seen.has(String(item?.id ?? "")));
  const hasFreshCandidate = unseen.length > 0;

  const results = needVerify
    ? await filterByTagRules(unseen, conditionTerms, tagVerdicts)
    : unseen;

  const slice = results.slice(0, JM_SEARCH_PAGE_SIZE);
  for (const item of slice) {
    const id = String(item?.id ?? "");
    if (id) {
      seen.add(id);
      plan.seen.push(id);
    }
  }

  // 条件没拆出来(比如关键词里带 + 但不是标签), 结果又为空, 交给普通搜索兜底
  if (slice.length === 0 && page <= 1 && query.picked.length === 0) {
    return null;
  }

  const hasReachedMax = slice.length === 0 || (!hasFreshCandidate && exhausted);

  return build(slice, results.length, {
    hasReachedMax,
    extern: { tagSearch: plan },
  });
}

async function searchComic(payload: JmSearchPayload = {}): Promise<SearchResultContract> {
  const extern = toStringMap(payload.extern);
  const imageBase = await getImageBaseUrl();
  const page = Math.max(1, toNum(payload.page, 1));
  const keyword = String(payload.keyword ?? extern.keyword ?? "").trim();
  const keywordLower = keyword.toLowerCase();
  const order = String(extern.sort ?? sortByToOrder(extern.sortBy)).trim();
  const path = `${await getApiBaseUrl()}/search`;
  const searchPageSize = JM_SEARCH_PAGE_SIZE;
  const buildResult = (
    content: any[],
    total: number,
    override?: { hasReachedMax?: boolean; extern?: Record<string, unknown> },
  ): SearchResultContract => {
    const scheme = {
      version: "1.0.0" as const,
      type: "searchResult" as const,
      source: JM_PLUGIN_ID,
      list: "comicGrid",
    };

    const data = {
      paging: {
        page,
        pages: page,
        total,
        hasReachedMax:
          override?.hasReachedMax ??
          (content.length === 0 ||
            content.length < searchPageSize ||
            (total > 0 && (page - 1) * searchPageSize + content.length >= total)),
      },
      items: content.map((item: any) => toComicItem(item, imageBase)),
    };

    return {
      source: JM_PLUGIN_ID,
      extern: {
        ...extern,
        sortBy: toNum(extern.sortBy, 1),
        ...override?.extern,
      },
      scheme,
      data,
      paging: data.paging,
      items: data.items,
    };
  };

  if ((Number(keyword) >= 100 || keywordLower.startsWith("jm")) && page === 1) {
    const comicId = keywordLower.startsWith("jm") ? keyword.slice(2).trim() : keyword;
    if (comicId) {
      try {
        const detailResponse = await getComicDetail({ comicId });
        const comicInfo = (detailResponse?.data?.raw as Record<string, any>)?.comicInfo as
          | Record<string, any>
          | undefined;
        if (comicInfo?.id) {
          return buildResult(
            [
              {
                ...comicInfo,
                author: Array.isArray(comicInfo.author)
                  ? comicInfo.author.join("/")
                  : comicInfo.author,
                total_views: comicInfo.total_views ?? comicInfo.totalViews,
                update_at: comicInfo.update_at ?? comicInfo.addtime,
              },
            ],
            1,
          );
        }
      } catch {
        // ignore direct-id fallback failure and continue with normal search
      }
    }
  }

  // 多条件: 关键词里的 "A+B", 或高级搜索里勾选的标签
  const tagQuery = await resolveTagQuery(extern, keyword);
  if (tagQuery) {
    const tagResult = await runTagSearch({
      query: tagQuery,
      extern,
      page,
      order,
      build: buildResult,
    });
    if (tagResult) {
      return tagResult;
    }
  }

  const response = (await jmRequest({
    path,
    method: "GET",
    params: {
      search_query: keyword,
      page,
      o: order,
    },
  })) as Record<string, any>;

  const content = Array.isArray(response.content) ? response.content : [];

  return buildResult(content, toNum(response.total, content.length));
}

function buildHomeSectionAction(section: any) {
  const title = String(section?.title ?? "").trim();
  const id = String(section?.id ?? "").trim();

  if (
    title.includes("推荐") ||
    title.includes("推薦") ||
    id === "30" ||
    title === "禁漫去码&全彩化" ||
    title === "禁漫去碼&全彩化"
  ) {
    return openComicListAction(
      buildComicListScene({
        title,
        list: {
          fnPath: "getPromoteListData",
          core: {
            id: toNum(id),
            path: "/promote_list",
          },
          extern: {
            source: "promoteList",
            pages: 27,
          },
        },
      }),
    );
  }
  if (id === "26" || title.endsWith("连载更新")) {
    return openComicListAction(
      buildComicListScene({
        title: "每周连载更新",
        list: {
          fnPath: "getWeekRankingData",
          extern: { source: "weekRanking" },
        },
        filter: {
          fnPath: "getWeekRankingFilterBundle",
          extern: { source: "weekRanking" },
        },
      }),
    );
  }
  if (id === "998" || title === "禁漫汉化组") {
    return openComicListAction(
      buildComicListScene({
        title,
        list: {
          fnPath: "getRankingData",
          extern: { source: "ranking" },
        },
        filter: {
          fnPath: "getTimeRankingFilterBundle",
          core: { tag: "禁漫汉化组" },
          extern: { source: "timeRanking" },
        },
      }),
    );
  }
  if (id === "999" || title === "韩漫更新") {
    return openComicListAction(
      buildComicListScene({
        title,
        list: {
          fnPath: "getRankingData",
          extern: { source: "ranking" },
        },
        filter: {
          fnPath: "getTimeRankingFilterBundle",
          core: { tag: "hanManTypeMap" },
          extern: { source: "timeRanking" },
        },
      }),
    );
  }
  if (id === "1000" || title === "其他更新") {
    return openComicListAction(
      buildComicListScene({
        title,
        list: {
          fnPath: "getRankingData",
          extern: { source: "ranking" },
        },
        filter: {
          fnPath: "getTimeRankingFilterBundle",
          core: { tag: "qiTaLeiTypeMap" },
          extern: { source: "timeRanking" },
        },
      }),
    );
  }

  return {
    type: "none",
    payload: {},
  };
}

async function getHomeRecommendData(
  payload: JmHomePayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  const promotePath = `${await getApiBaseUrl()}/promote?page=0`;

  const promote = await jmRequest({
    path: promotePath,
    method: "GET",
    cache: true,
  });

  const normalizedSections = await Promise.all(
    (Array.isArray(promote) ? promote : []).map(async (section: any) => ({
      ...section,
      title: await normalizeHomeSectionTitle(section?.title),
    })),
  );

  const imageBase = await getImageBaseUrl();
  const sections = normalizedSections
    .filter((section: any) => {
      const title = String(section?.title ?? "");
      return title !== "禁漫书库" && title !== "禁漫小说";
    })
    .map((section: any) => ({
      id: String(section?.id ?? ""),
      title: String(section?.title ?? ""),
      subtitle: "",
      action: buildHomeSectionAction(section),
      body: {
        type: "comic-list",
        direction: "horizontal",
        key: "items",
      },
      items: (Array.isArray(section?.content) ? section.content : []).map((item: any) =>
        toComicItem(item, imageBase),
      ),
      raw: section,
    }));

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "homeRecommend",
    },
    data: {
      sections,
      hasReachedMax: true,
    },
  };
}

async function getHomeLatestData(
  payload: JmHomePayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  const page = Number.isFinite(Number(payload.page)) ? Number(payload.page) : 0;
  const path = `${await getApiBaseUrl()}/latest`;
  const suggestion = await jmRequest({
    path,
    method: "GET",
    params: { page: Math.max(0, page) },
    cache: true,
  });

  const imageBase = await getImageBaseUrl();
  const suggestionItems = (Array.isArray(suggestion) ? suggestion : []).map((item: any) =>
    toComicItem(item, imageBase),
  );

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "homeLatest",
    },
    data: {
      page,
      suggestionItems,
      hasReachedMax: suggestionItems.length < 80,
    },
  };
}

async function getRankingData(
  payload: JmRankingPayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  const page = Number.isFinite(Number(payload.page)) ? Number(payload.page) : 0;
  const extern = toStringMap(payload.extern);
  const c = String(extern.type ?? extern.c ?? "");
  const o = String(extern.order ?? extern.o ?? "");
  const path = `${await getApiBaseUrl()}/categories/filter`;
  const imageBase = await getImageBaseUrl();
  const rankingPageSize = 80;

  const raw = await jmRequest({
    path,
    method: "GET",
    params: { page, c, o },
    cache: true,
  });

  const total = toNum((raw as any)?.total, 0);
  const content = Array.isArray((raw as any)?.content) ? (raw as any).content : [];
  const loadedCount = Math.max(0, page - 1) * rankingPageSize + content.length;
  const hasReachedMax =
    content.length === 0 || content.length < rankingPageSize || (total > 0 && loadedCount >= total);

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "rankingFeed",
      card: "comic",
    },
    data: {
      page,
      total,
      hasReachedMax,
      items: content.map((item: any) => toComicItem(item, imageBase)),
      raw,
    },
  };
}

async function getPromoteListData(
  payload: JmPromoteListPayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  console.debug(payload);
  const id = toNum(payload.id, 0);
  const page = Math.max(0, toNum(payload.page, 0));
  const path = `${await getApiBaseUrl()}/promote_list`;
  const imageBase = await getImageBaseUrl();
  const pageSize = 27;

  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { id, page },
    cache: true,
  })) as Record<string, any>;

  const total = toNum(raw.total, 0);
  const list = Array.isArray(raw.list) ? raw.list : [];
  const loadedCount = Math.max(0, page - 1) * pageSize + list.length;
  const hasReachedMax =
    list.length === 0 || list.length < pageSize || (total > 0 && loadedCount >= total);

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "promoteListFeed",
      card: "comic",
    },
    data: {
      id,
      page,
      total,
      hasReachedMax,
      items: list.map((item: any) => toComicItem(item, imageBase)),
      raw,
    },
  };
}

async function getLatestData(
  payload: JmRankingPayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  const page = Math.max(1, toNum(payload.page, 1));
  const imageBase = await getImageBaseUrl();
  if (page == 1) {
    const latest = await getHomeLatestData({
      page: 0,
    });
    const list = Array.isArray((latest as any)?.data?.suggestionItems)
      ? (latest as any).data.suggestionItems
      : [];

    return {
      source: JM_PLUGIN_ID,
      extern: payload.extern ?? null,
      scheme: {
        version: "1.0.0",
        type: "latestFeed",
        card: "comic",
      },
      data: {
        page,
        hasReachedMax: list.length < 80,
        items: list,
        raw: latest,
      },
    };
  }

  const requestPage = Math.max(0, page - 1);
  const path = `${await getApiBaseUrl()}/latest`;
  const pageSize = 80;
  const raw = await jmRequest({
    path,
    method: "GET",
    params: { page: requestPage },
    cache: true,
  });

  console.debug(raw);

  const list = Array.isArray(raw) ? raw : [];
  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "latestFeed",
      card: "comic",
    },
    data: {
      page,
      hasReachedMax: list.length === 0 || list.length < pageSize,
      items: list.map((item: any) => toComicItem(item, imageBase)),
      raw,
    },
  };
}

async function getCloudFavoriteData(
  payload: JmCloudFavoritePayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  const page = Math.max(1, toNum(payload.page, 1));
  const imageBase = await getImageBaseUrl();
  const extern = toStringMap(payload.extern);
  const folderId = String(payload.folderId ?? extern.folderId ?? "");
  const order = String(payload.order ?? extern.order ?? "mr") || "mr";
  const path = `${await getApiBaseUrl()}/favorite`;
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page, folder_id: folderId, o: order },
    cache: false,
  })) as Record<string, any>;

  const list = Array.isArray(raw.list) ? raw.list : [];
  const total = toNum(raw.total, 0);
  const hasReachedMax = total > 0 ? page * 20 >= total : list.length < 20;

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "cloudFavoriteFeed",
      card: "comic",
    },
    data: {
      page,
      total,
      hasReachedMax,
      items: list.map((item: any) => toComicItem(item, imageBase)),
      raw,
    },
  };
}

async function toggleLike(payload: JmLikePayload = {}): Promise<ToggleLikeResult> {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const currentLiked = toBool(payload.currentLiked, false);
  if (currentLiked) {
    flutterTools.showToast({
      message: "JM 暂不支持取消点赞",
      level: "warning",
    });
    return {
      liked: true,
    };
  }

  const path = `${await getApiBaseUrl()}/like`;
  const raw = (await jmRequest({
    path,
    method: "POST",
    formData: { id: comicId },
    cache: false,
  })) as Record<string, any>;
  const status = String(raw?.status ?? "")
    .trim()
    .toLowerCase();
  if (status && status !== "ok" && status !== "success") {
    throw new Error(String(raw?.msg ?? raw?.errorMsg ?? "点赞失败").trim() || "点赞失败");
  }

  return {
    liked: true,
  };
}

const JM_FAVORITE_CONTINUATION_PREFIX = "jm-favorite:v1:";
const JM_FAVORITE_CONTINUATION_TTL_MS = 15 * 60 * 1000;
const JM_FAVORITE_DEFAULT_OPTION_ID = "__default__";

type JmFavoriteContinuation = {
  action: "add" | "move";
  comicId: string;
  currentFavorite: boolean;
  folderIds: string[];
  createdAt: number;
};

type JmFavoriteFolder = { id: string; name: string };

function favoriteFailure(error: unknown, currentFavorite = false): FavoriteWorkflowResult {
  return {
    status: "failed",
    favorited: currentFavorite,
    committed: false,
    message: error instanceof Error ? error.message : String(error),
    errorCode: "FAVORITE_WORKFLOW_FAILED",
  };
}

function encodeFavoriteContinuation(value: JmFavoriteContinuation): string {
  return `${JM_FAVORITE_CONTINUATION_PREFIX}${encodeURIComponent(JSON.stringify(value))}`;
}

function decodeFavoriteContinuation(value: string): JmFavoriteContinuation | null {
  const raw = String(value ?? "");
  if (!raw.startsWith(JM_FAVORITE_CONTINUATION_PREFIX)) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      decodeURIComponent(raw.slice(JM_FAVORITE_CONTINUATION_PREFIX.length)),
    ) as Partial<JmFavoriteContinuation>;
    const comicId = String(parsed.comicId ?? "").trim();
    const folderIds = Array.isArray(parsed.folderIds)
      ? parsed.folderIds.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)
      : [];
    const createdAt = Number(parsed.createdAt ?? 0);
    if (
      (parsed.action !== "add" && parsed.action !== "move") ||
      !comicId ||
      !Number.isFinite(createdAt) ||
      Date.now() - createdAt > JM_FAVORITE_CONTINUATION_TTL_MS
    ) {
      return null;
    }
    return {
      action: parsed.action,
      comicId,
      currentFavorite: parsed.currentFavorite === true,
      folderIds,
      createdAt,
    };
  } catch {
    return null;
  }
}

async function fetchJmFavoriteFolders(): Promise<JmFavoriteFolder[]> {
  const raw = await jmRequest({
    path: `${await getApiBaseUrl()}/favorite`,
    method: "GET",
    params: { page: 1, folder_id: "", o: "mr" },
    cache: false,
  });
  const folderList = raw && typeof raw === "object" && "folder_list" in raw ? raw.folder_list : [];
  const folders = Array.isArray(folderList) ? folderList : [];
  return folders
    .map((item) => {
      const record = toStringMap(item);
      return {
        id: String(record.FID ?? "").trim(),
        name: String(record.name ?? "").trim(),
      };
    })
    .filter((item) => item.id.length > 0);
}
async function addJmFavorite(comicId: string): Promise<Record<string, any>> {
  const raw = (await jmRequest({
    path: `${await getApiBaseUrl()}/favorite`,
    method: "POST",
    formData: { aid: comicId },
    cache: false,
  })) as Record<string, any>;
  const status = String(raw?.status ?? "")
    .trim()
    .toLowerCase();
  if (status && status !== "ok") {
    throw new Error(String(raw?.msg ?? "收藏失败").trim() || "收藏失败");
  }
  return raw;
}
async function removeJmFavorite(comicId: string): Promise<Record<string, any>> {
  const raw = (await jmRequest({
    path: `${await getApiBaseUrl()}/favorite`,
    method: "POST",
    formData: { aid: comicId },
    cache: false,
  })) as Record<string, any>;
  const status = String(raw?.status ?? "")
    .trim()
    .toLowerCase();
  if (status && status !== "ok") {
    throw new Error(String(raw?.msg ?? "取消收藏失败").trim() || "取消收藏失败");
  }
  return raw;
}

async function createJmFavoriteFolder(name: string): Promise<JmFavoriteFolder> {
  const folderName = name.trim();
  const raw = (await jmRequest({
    path: `${await getApiBaseUrl()}/favorite_folder`,
    method: "POST",
    formData: {
      type: "add",
      folder_id: "",
      folder_name: folderName,
      aid: "",
    },
    cache: false,
  })) as Record<string, any>;

  const status = String(raw?.status ?? "")
    .trim()
    .toLowerCase();
  if (status && status !== "ok") {
    throw new Error(String(raw?.msg ?? "新建收藏夹失败").trim() || "新建收藏夹失败");
  }
  const id = String(raw?.FID ?? raw?.folder_id ?? "").trim();
  if (id) {
    return { id, name: folderName };
  }
  const folders = await fetchJmFavoriteFolders();
  const created = folders.find((folder) => folder.name === folderName);
  if (!created) {
    throw new Error(String(raw?.msg ?? "新建收藏夹失败").trim() || "新建收藏夹失败");
  }
  return created;
}

async function moveJmFavorite(comicId: string, folderId: string): Promise<void> {
  const raw = (await jmRequest({
    path: `${await getApiBaseUrl()}/favorite_folder`,
    method: "POST",
    formData: {
      type: "move",
      folder_id: folderId,
      folder_name: "",
      aid: comicId,
    },
    cache: false,
  })) as Record<string, any>;
  const status = String(raw?.status ?? "")
    .trim()
    .toLowerCase();
  if (status && status !== "ok") {
    throw new Error(String(raw?.msg ?? "移动收藏失败").trim() || "移动收藏失败");
  }
}

function buildJmFavoriteFolderInput(
  folders: JmFavoriteFolder[],
  title: string,
  description: string,
): FavoriteWorkflowInput {
  return {
    type: "select",
    key: "folderId",
    title,
    description,
    required: true,
    selection: "single",
    options: [
      { id: JM_FAVORITE_DEFAULT_OPTION_ID, label: "默认收藏夹" },
      ...folders.map((folder) => ({
        id: folder.id,
        label: folder.name || folder.id,
      })),
    ],
    allowCreate: true,
    createField: {
      key: "folderName",
      type: "text",
      label: "新建收藏夹",
      placeholder: "输入收藏夹名称",
    },
  };
}

async function startFavoriteAction(
  payload: FavoriteWorkflowStartPayload,
): Promise<FavoriteWorkflowResult> {
  const comicId = String(payload.comicId ?? "").trim();
  const action = payload.action;
  if (!comicId) {
    return favoriteFailure(new Error("comicId 不能为空"), false);
  }
  if (action === "add" || action === "move") {
    try {
      const folders = await fetchJmFavoriteFolders();
      return {
        status: "awaitingInput",
        favorited: action === "move",
        committed: false,
        continuationToken: encodeFavoriteContinuation({
          action,
          comicId,
          currentFavorite: action === "move",
          folderIds: folders.map((folder) => folder.id),
          createdAt: Date.now(),
        }),
        input: buildJmFavoriteFolderInput(
          folders,
          action === "add" ? "加入收藏" : "移动到收藏夹",
          action === "add" ? "请选择收藏夹" : "请选择目标收藏夹",
        ),
      };
    } catch (error) {
      return favoriteFailure(error, action === "move");
    }
  }
  if (action === "removeAll") {
    try {
      await removeJmFavorite(comicId);
      return { status: "completed", favorited: false, committed: true };
    } catch (error) {
      return favoriteFailure(error, true);
    }
  }
  if (action === "removeFromTarget") {
    return favoriteFailure(new Error("当前图源只支持全局取消收藏"), true);
  }
  return favoriteFailure(new Error("不支持的收藏操作"), false);
}

async function continueFavoriteAction(
  payload: FavoriteWorkflowContinuePayload,
): Promise<FavoriteWorkflowResult> {
  const token = decodeFavoriteContinuation(String(payload.continuationToken ?? ""));
  if (
    !token ||
    token.comicId !== String(payload.comicId ?? "").trim() ||
    token.action !== payload.action
  ) {
    return favoriteFailure(new Error("收藏工作流令牌无效或已过期"), false);
  }
  const input = payload.input ?? {};
  if (input.cancelled) {
    return {
      status: "cancelled",
      favorited: token.currentFavorite,
      committed: false,
      message: "用户取消了收藏操作",
    };
  }
  try {
    const created = String(input.created ?? "").trim();
    if (created) {
      const folder = await createJmFavoriteFolder(created);
      if (token.action === "add") {
        await addJmFavorite(token.comicId);
      }
      await moveJmFavorite(token.comicId, folder.id);
      return { status: "completed", favorited: true, committed: true };
    }
    const folderId = String(input.value ?? "").trim();
    if (token.action === "add") {
      await addJmFavorite(token.comicId);
      if (folderId && folderId !== JM_FAVORITE_DEFAULT_OPTION_ID) {
        await moveJmFavorite(token.comicId, folderId);
      }
      return { status: "completed", favorited: true, committed: true };
    }
    if (!folderId || folderId === JM_FAVORITE_DEFAULT_OPTION_ID) {
      throw new Error("未选择有效的收藏夹");
    }
    await moveJmFavorite(token.comicId, folderId);
    return { status: "completed", favorited: true, committed: true };
  } catch (error) {
    return { ...favoriteFailure(error), favorited: true };
  }
}

function buildJmUserCover(photo: unknown, imageBase: string): string {
  const file = String(photo ?? "").trim();
  if (!file) {
    return "";
  }
  if (file.startsWith("http://") || file.startsWith("https://")) {
    return file;
  }
  return `${imageBase}/media/users/${file}`;
}

function mapJmReplyItem(item: any, imageBase: string): CommentItem {
  const id = String(item?.CID ?? "");
  const photo = String(item?.photo ?? "").trim();
  return {
    id,
    author: {
      name: String(item?.nickname ?? item?.username ?? "匿名用户"),
      avatar: {
        url: buildJmUserCover(photo, imageBase),
        path: photo ? `${String(item?.UID ?? "")}.jpg` : "",
      },
    },
    content: stripHtmlTags(item?.content),
    createdAt: formatDisplayTime(item?.addtime),
    replyCount: 0,
    replies: [],
    extern: {
      commentId: id,
    },
  };
}

function mapJmCommentItem(item: any, imageBase: string): CommentItem {
  const id = String(item?.CID ?? "");
  const photo = String(item?.photo ?? "").trim();
  const replies = Array.isArray(item?.replys) ? item.replys : [];
  return {
    id,
    author: {
      name: String(item?.nickname ?? item?.username ?? "匿名用户"),
      avatar: {
        url: buildJmUserCover(photo, imageBase),
        path: photo ? `${String(item?.UID ?? "")}.jpg` : "",
      },
    },
    content: stripHtmlTags(item?.content),
    createdAt: formatDisplayTime(item?.addtime),
    replyCount: replies.length,
    replies: replies.map((reply: any) => mapJmReplyItem(reply, imageBase)),
    extern: {
      commentId: id,
    },
  };
}

async function getCommentFeed(payload: JmCommentFeedPayload = {}): Promise<CommentFeedContract> {
  const comicId = String(payload.comicId ?? "").trim();
  const page = Math.max(1, toNum(payload.page, 1));
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const path = `${await getApiBaseUrl()}/forum`;
  const imageBase = await getImageBaseUrl();
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page, mode: "manhua", aid: comicId },
    cache: false,
  })) as Record<string, any>;

  const list = Array.isArray(raw?.list) ? raw.list : [];
  const total = toNum(raw?.total, 0);
  const pageSize = 10;
  const hasReachedMax = list.length < pageSize || page * pageSize >= total;

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "commentFeed",
    },
    data: {
      replyMode: "embedded",
      canComment: {
        comic: false,
        reply: false,
      },
      paging: {
        hasReachedMax,
      },
      topItems: [],
      items: list.map((item: any) => mapJmCommentItem(item, imageBase)),
    },
  };
}

async function getWeekRankingData(
  payload: JmWeekRankingPayload = {},
): Promise<{ source: string; extern: unknown; scheme: unknown; data: unknown }> {
  const date = toNum(payload.date, 0);
  const type = String(payload.type ?? "all");
  const page = Math.max(1, toNum(payload.page, 1));
  const path = `${await getApiBaseUrl()}/serialization`;
  const imageBase = await getImageBaseUrl();
  const pageSize = 40;

  const raw = await jmRequest({
    path,
    method: "GET",
    params: { date, type, page },
    cache: true,
  });

  if ((raw as Record<string, any>)["error"] === "没有资料") {
    return {
      source: JM_PLUGIN_ID,
      extern: payload.extern ?? null,
      scheme: {
        version: "1.0.0",
        type: "weekRankingFeed",
        card: "comic",
      },
      data: {
        date,
        page,
        hasReachedMax: true,
        items: [],
        raw,
      },
    };
  }

  const list = Array.isArray((raw as Record<string, any>).list)
    ? (raw as Record<string, any>).list
    : [];
  const hasReachedMax = list.length === 0 || list.length < pageSize;

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "weekRankingFeed",
      card: "comic",
    },
    data: {
      date,
      page,
      hasReachedMax,
      items: list.map((item: any) => toComicItem(item, imageBase)),
      raw,
    },
  };
}

async function getChapter(payload: ChapterPayload = {}): Promise<ChapterContentContract> {
  console.debug(payload);
  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) {
    throw new Error("chapterId 不能为空");
  }

  const path = `${await getApiBaseUrl()}/chapter`;
  const response = (await jmRequest({
    path,
    method: "GET",
    params: {
      skip: "",
      id: chapterId,
    },
    cache: true,
  })) as Record<string, any>;

  const images = Array.isArray(response.images) ? response.images : [];
  const imageBase = String(await getImageBaseUrl()).trim();
  const pages: ChapterPage[] = images.map((image) => ({
    id: String(image ?? ""),
    name: String(image ?? ""),
    path: String(image ?? ""),
    url: imageBase ? `${imageBase}/media/photos/${chapterId}/${String(image ?? "")}` : "",
    extern: {},
  }));

  const comicId = String(payload.comicId ?? "");
  const chapter: ChapterWithPages = {
    id: String(response.id ?? chapterId),
    requestId: String(response.id ?? chapterId),
    logicalKey: String(response.id ?? chapterId),
    storageChapterId: String(response.id ?? chapterId),
    name: String(response.name ?? ""),
    order: 0,
    pages,
    extern: {},
  };

  return {
    source: JM_PLUGIN_ID,
    comicId,
    chapterId,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "chapterContent",
      source: JM_PLUGIN_ID,
    },
    data: {
      comic: { id: comicId, source: JM_PLUGIN_ID, title: "", extern: {} },
      chapter,
      chapters: [chapter],
    },
  };
}
async function getReadSnapshot(payload: JmReadSnapshotPayload = {}): Promise<ReadSnapshotContract> {
  console.debug(payload);
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const externInput = toStringMap(payload.extern);
  const detail = await getComicDetail({
    comicId,
    extern: payload.extern,
  });
  const normal = (detail as any)?.data?.normal ?? (detail as any)?.normal ?? {};

  const chapterRefs = (Array.isArray(normal?.eps) ? normal.eps : []).map((ep: any) => {
    const id = String(ep?.id ?? "");
    const order = toNum(ep?.order, 0);
    return {
      id,
      requestId: String(ep?.requestId ?? id),
      logicalKey: String(ep?.logicalKey ?? id),
      storageChapterId: String(ep?.storageChapterId ?? id),
      name: String(ep?.name ?? ""),
      order,
      extern: {
        sort: toNum(ep?.extern?.sort, order),
        ...toStringMap(ep?.extern),
      },
    };
  });

  let chapterId = String(payload.chapterId ?? "").trim();
  const order = toNum(externInput.order, 0);
  if (!chapterId && order > 0) {
    const found = chapterRefs.find((item: any) => toNum(item?.order, 0) === order);
    chapterId = String(found?.id ?? "").trim();
  }
  if (!chapterId) {
    chapterId = String(chapterRefs[0]?.id ?? "").trim();
  }
  if (!chapterId) {
    throw new Error("chapterId 不能为空");
  }

  const chapterBundle = await getChapter({
    comicId,
    chapterId,
    extern: payload.extern,
  });
  const chapterData =
    (chapterBundle as any)?.data?.chapter ?? (chapterBundle as any)?.chapter ?? {};
  const pages = (Array.isArray(chapterData?.pages) ? chapterData.pages : []).map((doc: any) => ({
    id: String(doc?.id ?? ""),
    name: String(doc?.name ?? doc?.originalName ?? ""),
    path: String(doc?.path ?? ""),
    url: String(doc?.url ?? doc?.fileServer ?? ""),
    extern: toStringMap(doc?.extern),
  }));

  const currentChapter = chapterRefs.find((item: any) => String(item.id) === String(chapterId)) ??
    chapterRefs.find((item: any) => toNum(item?.order, 0) === order) ?? {
      id: String(chapterData?.id ?? chapterId),
      requestId: String(chapterData?.requestId ?? chapterData?.id ?? chapterId),
      logicalKey: String(chapterData?.logicalKey ?? chapterData?.id ?? chapterId),
      storageChapterId: String(chapterData?.storageChapterId ?? chapterData?.id ?? chapterId),
      name: String(chapterData?.name ?? ""),
      order: order > 0 ? order : 1,
      extern: {},
    };

  const comicInfo = normal?.comicInfo ?? {};

  const result = {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: {
        id: String(comicInfo?.id ?? comicId),
        source: JM_PLUGIN_ID,
        title: String(comicInfo?.title ?? ""),
        description: String(comicInfo?.description ?? ""),
        cover: {
          ...comicInfo?.cover,
          extern: toStringMap(comicInfo?.cover?.extern),
        },
        creator: {
          ...comicInfo?.creator,
          avatar: {
            ...comicInfo?.creator?.avatar,
            extern: toStringMap(comicInfo?.creator?.avatar?.extern),
          },
          extern: toStringMap(comicInfo?.creator?.extern),
        },
        titleMeta: (Array.isArray(comicInfo?.titleMeta) ? comicInfo.titleMeta : []).map(
          (item: any) => ({
            name: String(item?.name ?? ""),
            onTap: toStringMap(item?.onTap),
            extern: toStringMap(item?.extern),
          }),
        ),
        metadata: (Array.isArray(comicInfo?.metadata) ? comicInfo.metadata : []).map(
          (meta: any) => ({
            type: String(meta?.type ?? ""),
            name: String(meta?.name ?? ""),
            value: (Array.isArray(meta?.value) ? meta.value : []).map((item: any) => ({
              name: String(item?.name ?? ""),
              onTap: toStringMap(item?.onTap),
              extern: toStringMap(item?.extern),
            })),
          }),
        ),
        extern: toStringMap(comicInfo?.extern),
      },
      chapter: {
        id: String(chapterData?.id ?? currentChapter.id),
        requestId: String(chapterData?.requestId ?? currentChapter.requestId ?? currentChapter.id),
        logicalKey: String(
          chapterData?.logicalKey ?? currentChapter.logicalKey ?? currentChapter.id,
        ),
        storageChapterId: String(
          chapterData?.storageChapterId ?? currentChapter.storageChapterId ?? currentChapter.id,
        ),
        name: String(chapterData?.name ?? currentChapter.name),
        order: toNum(currentChapter.order, 0),
        pages,
        extern: toStringMap(chapterData?.extern),
      },
      chapters: chapterRefs,
    },
  };
  return result;
}

export default {
  init,
  jmRequest,
  getComicDetail,
  getSettingsBundle,
  getUserInfoBundle,
  getLoginBundle,
  loginWithPassword,
  getCapabilitiesBundle,
  getComicListSceneBundle,
  getInfo,
  getFunctionPage,
  getCloudFavoriteFilterBundle,
  getCloudFavoriteSceneBundle,
  getRankingFilterBundle,
  getAdvancedSearchScheme,
  getWeekRankingFilterBundle,
  getTimeRankingFilterBundle,
  clearPluginSession,
  dumpRuntimeInfo,
  getHomeLatestData,
  getRankingData,
  getPromoteListData,
  getLatestData,
  getCloudFavoriteData,
  getCommentFeed,
  toggleLike,
  startFavoriteAction,
  continueFavoriteAction,
  getWeekRankingData,
  searchComic,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,
};
