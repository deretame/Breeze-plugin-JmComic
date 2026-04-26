import axios from "axios";
import { runtime } from "../types/runtime-api";
import { Config } from "./constants";
import { createJmClient, setUnauthorizedSchemeProvider } from "./client";
import { toFriendlyError } from "./errors";
import { buildPluginInfo } from "./get-info";
import { buildRequestConfig } from "./request-config";
import { getCachedResponse } from "./state";
import type { RequestPayload } from "./types";
import { flutterTools, pluginConfig } from "./tools";

const JM_PLUGIN_ID = "bf99008d-010b-4f17-ac7c-61a9b57dc3d9";

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
  const resolvedJwtToken =
    String(input.jwtToken ?? "").trim() ||
    String(await loadPluginSetting("auth.jwt", "")).trim();
  const { config, cacheEnabled } = await buildRequestConfig({
    ...input,
    jwtToken: resolvedJwtToken,
  });

  try {
    const response = await jmClient.request(config);
    return response.data;
  } catch (err) {
    if (
      cacheEnabled &&
      String(config.method || "GET").toUpperCase() === "GET"
    ) {
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

type JmReadSnapshotPayload = {
  comicId?: string;
  chapterId?: string;
  extern?: Record<string, unknown>;
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

type JmPromoteListPayload = {
  id?: number;
  page?: number;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmWeekRankingPayload = {
  date?: number;
  type?: string;
  page?: number;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmCloudFavoritePayload = {
  page?: number;
  folderId?: string;
  order?: string;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmLikePayload = {
  comicId?: string;
  currentLiked?: boolean;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmToggleFavoritePayload = {
  comicId?: string;
  currentFavorite?: boolean;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmFavoriteFolderPayload = {
  comicId?: string;
  folderId?: string;
  folderName?: string;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type JmCommentFeedPayload = {
  comicId?: string;
  page?: number;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

type RankingFilterOption = {
  label: string;
  value: string;
  result: Record<string, unknown>;
  children?: RankingFilterOption[];
};

type JmLoginPayload = {
  account?: string;
  password?: string;
  extern?: Record<string, unknown>;
  path?: string;
  useJwt?: boolean;
  jwtToken?: string;
};

const JM_SEARCH_CATEGORY_OPTIONS = [
  { label: "同人", value: "同人" },
  { label: "单本", value: "单本" },
  { label: "短篇", value: "短篇" },
  { label: "其他类", value: "其他类" },
  { label: "韩漫", value: "韩漫" },
  { label: "English Manga", value: "English Manga" },
];

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

  const normalized = raw.includes("T")
    ? raw
    : raw.replace(" ", "T").replace(/\//g, "-");
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

function buildMetadata(type: string, name: string, value: unknown) {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
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

function createActionItem(
  name: unknown,
  onTap: Record<string, unknown> = {},
  extension: Record<string, unknown> = {},
) {
  return {
    name: String(name ?? ""),
    onTap,
    extension,
  };
}

function createMetadataActionList(
  type: string,
  name: string,
  values: unknown,
  mapItem?: (value: string) => ReturnType<typeof createActionItem>,
) {
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
  extension?: Record<string, unknown>;
}) {
  return {
    id: String(input.id ?? ""),
    url: String(input.url ?? ""),
    name: String(input.name ?? ""),
    path: String(input.path ?? ""),
    extension: input.extension ?? {},
  };
}

function openSearchAction(payload: Record<string, unknown>) {
  const source = String(payload.source ?? "").trim();
  const keyword = String(payload.keyword ?? "").trim();
  const inheritedExtern =
    payload.extern &&
    typeof payload.extern === "object" &&
    !Array.isArray(payload.extern)
      ? (payload.extern as Record<string, unknown>)
      : {};
  const extern = {
    ...inheritedExtern,
    ...(typeof payload.url === "string" && payload.url.trim().length
      ? { url: payload.url.trim() }
      : {}),
    ...(Array.isArray(payload.categories)
      ? { categories: payload.categories }
      : {}),
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

function buildJmCoverUrl(item: any): string {
  const image = String(item?.image ?? "").trim();
  if (image.startsWith("http://") || image.startsWith("https://")) {
    return image;
  }

  const imageBase = Config.imagesUrl;
  if (!imageBase) {
    return image;
  }

  if (image.startsWith("/")) {
    return `${imageBase}${image}`;
  }

  if (image.startsWith("media/")) {
    return `${imageBase}/${image}`;
  }

  const id = String(item?.id ?? "").trim();
  if (!id) {
    return image;
  }

  return `${imageBase}/media/albums/${id}_3x4.jpg`;
}

function toComicItem(item: any) {
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
      url: buildJmCoverUrl(item),
      path: `${id}.jpg`,
      extern: {
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
        id:
          item?.category_sub?.id == null ? null : String(item.category_sub.id),
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

function boolKeyList(value: unknown): string[] {
  const map = toStringMap(value);
  return Object.entries(map)
    .filter(([, checked]) => Boolean(checked))
    .map(([key]) => key);
}

function toBoolMap(values: string[]): Record<string, boolean> {
  return values.reduce<Record<string, boolean>>((acc, item) => {
    if (item.trim()) {
      acc[item] = true;
    }
    return acc;
  }, {});
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
    createChoiceOption(
      "English Manga",
      "meiman",
      { extern: { type: "meiman" } },
      [
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
      ],
    ),
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

function normalizeHomeSectionTitle(value: unknown): string {
  const title = String(value ?? "");
  if (title !== "连载更新→右滑看更多→") {
    return title;
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
  } catch (_) {
    // noop
  }
  return fallback;
}

async function loadBlockedCategories(): Promise<string[]> {
  const value = await loadPluginSetting("search.blockedCategories", []);
  return toStrList(value);
}

async function saveBlockedCategories(values: string[]) {
  await pluginConfig.save("search.blockedCategories", JSON.stringify(values));
}

async function getSettingsBundle() {
  const [account, password] = await Promise.all([
    loadPluginSetting("auth.account", ""),
    loadPluginSetting("auth.password", ""),
  ]);

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          id: "account",
          title: "账号",
          fields: [
            { key: "auth.account", kind: "text", label: "用户名" },
            { key: "auth.password", kind: "password", label: "密码" },
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      values: {
        "auth.account": String(account ?? ""),
        "auth.password": String(password ?? ""),
      },
    },
  };
}

async function getUserInfoBundle() {
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
    const password = String(
      await loadPluginSetting("auth.password", ""),
    ).trim();
    if (!account || !password) {
      return current;
    }

    const refreshed = (await jmRequest({
      path: `${Config.baseUrl}/login`,
      method: "POST",
      formData: { username: account, password },
      cache: false,
      useJwt: false,
    })) as Record<string, any>;
    await Promise.all([
      pluginConfig.save("auth.userInfo", JSON.stringify(refreshed)),
      pluginConfig.save(
        "auth.jwt",
        JSON.stringify(String(refreshed?.jwttoken ?? "")),
      ),
    ]);
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
        url: buildJmUserCover(photo),
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

async function getLoginBundle() {
  return {
    source: JM_PLUGIN_ID,
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

setUnauthorizedSchemeProvider(async () => {
  const bundle = await getLoginBundle();
  return bundle as Record<string, unknown>;
});

async function loginWithPassword(payload: JmLoginPayload = {}) {
  const account = String(payload.account ?? "").trim();
  const password = String(payload.password ?? "");
  if (!account || !password) {
    throw new Error("账号或密码不能为空");
  }

  const path = `${Config.baseUrl}/login`;
  let result: any;
  try {
    result = await jmRequest({
      path,
      method: "POST",
      formData: { username: account, password },
      useJwt: false,
    });
  } catch (error) {
    console.error(
      `[jm.login] request failed path=${path} accountLen=${account.length} message=${String((error as { message?: string } | null)?.message || error)}`,
    );
    throw error;
  }

  const jwtToken = String((result as any)?.jwttoken ?? "");
  await Promise.all([
    pluginConfig.save("auth.account", JSON.stringify(account)),
    pluginConfig.save("auth.password", JSON.stringify(password)),
    pluginConfig.save("auth.jwt", JSON.stringify(jwtToken)),
    pluginConfig.save("auth.userInfo", JSON.stringify(result)),
  ]);

  return {
    source: JM_PLUGIN_ID,
    data: {
      account,
      password,
      jwtToken,
    },
    raw: result,
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

async function resolveFastestBases() {
  try {
    const apiIdx = await getFastestUrlIndex(Config.baseUrls);
    Config.baseUrlIndex = apiIdx;
  } catch (error) {
    console.warn("[jm.init] choose fastest api base failed", error);
  }

  try {
    const imageIdx = await getFastestUrlIndex(Config.imagesUrls);
    Config.imagesUrlIndex = imageIdx;
  } catch (error) {
    console.warn("[jm.init] choose fastest image base failed", error);
  }

  let data = Config.baseUrl;

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
        url: `${Config.baseUrl}/daily_list/filter`,
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
        url: `${Config.baseUrl}/daily_chk`,
        method: "POST",
        formData: {
          user_id: uid,
          daily_id: dailyId,
        },
      });

      const msg = chkRes?.data?.msg ?? chkRes?.msg ?? "";

      if (msg !== "今天已经签到过了") {
        try {
          flutterTools.showToast({
            message: "禁漫自动签到成功！",
            level: "success",
          });
        } catch (_) {}
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
        const account = String(
          await loadPluginSetting("auth.account", ""),
        ).trim();
        const password = String(await loadPluginSetting("auth.password", ""));

        if (!account || !password) {
          console.info("[jm.init] skip auth/checkin: no credentials");
          return;
        }

        const data = await loginWithPassword({
          account,
          password,
          path: `${Config.baseUrl}/login`,
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
        console.warn(
          `[jm.init] login/checkin failed, retry in ${delay}ms`,
          error,
        );
        await waitMs(delay);
      }
    }
  } finally {
    jmAuthFlowRunning = false;
  }
}

async function init() {
  await resolveFastestBases();
  if (!jmInitStarted) {
    jmInitStarted = true;
    void runJmAuthAndCheckInLoop();
  }

  return {
    source: JM_PLUGIN_ID,
    data: {
      ok: true,
      started: true,
      runtimeImageBaseUrl: Config.baseUrl,
      fastestApiBase: Config.baseUrl,
    },
  };
}

async function getCapabilitiesBundle() {
  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "advancedActions",
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

function buildJmRecommendScene() {
  return buildComicListScene({
    title: "推荐",
    list: {
      fnPath: "getRecommendData",
      extern: { source: "recommend" },
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

function buildJmCloudFavoriteScene() {
  return buildComicListScene({
    title: "云端收藏",
    list: {
      fnPath: "getCloudFavoriteData",
      extern: { source: "cloudFavorite", order: "mr", folderId: "" },
    },
    filter: {
      fnPath: "getCloudFavoriteFilterBundle",
      extern: { source: "cloudFavorite" },
    },
  });
}

async function getCloudFavoriteFilterBundle(
  payload: JmCloudFavoritePayload = {},
) {
  const extern = toStringMap(payload.extern);
  const path = `${Config.baseUrl}/favorite`;
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page: 1, folder_id: "", o: "mr" },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
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
      version: "1.0.0",
      type: "rankingFilter",
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
      folderList,
      raw,
    },
  };
}

async function getCloudFavoriteSceneBundle() {
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

async function get_cloud_favorite_scene_bundle() {
  return getCloudFavoriteSceneBundle();
}

async function getInfo() {
  return buildPluginInfo({
    buildLatestScene: buildJmLatestScene,
    buildRankingScene: buildJmRankingScene,
  });
}

async function getFunctionPage(payload: Record<string, unknown> = {}) {
  const id = String(payload.id ?? toStringMap(payload.core).id ?? "").trim();
  if (id !== "recommend") {
    throw new Error(`未知功能: ${id}`);
  }

  const recommend = await getHomeRecommendData();
  const sections = Array.isArray((recommend as any)?.data?.sections)
    ? (recommend as any).data.sections
    : [];

  const pickedSections = sections
    .filter((section: any) => {
      const action = toStringMap(section?.action);
      if (String(action.type ?? "") !== "openComicList") {
        return false;
      }

      const scene = toStringMap(toStringMap(action.payload).scene);
      const list = toStringMap(scene.list);
      const filter = toStringMap(scene.filter);
      const listFn = String(list.fnPath ?? "").trim();
      const filterFn = String(filter.fnPath ?? "").trim();
      const tag = String(toStringMap(filter.core).tag ?? "").trim();

      if (listFn === "getWeekRankingData") {
        return true;
      }

      return (
        listFn === "getRankingData" &&
        filterFn === "getTimeRankingFilterBundle" &&
        ["禁漫汉化组", "hanManTypeMap", "qiTaLeiTypeMap"].includes(tag)
      );
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

  return {
    source: JM_PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "page",
      title: "推荐",
      body: {
        type: "list",
        direction: "vertical",
        children: [{ type: "comic-section-list", key: "sections" }],
      },
    },
    data: {
      sections: pickedSections,
      hasReachedMax: true,
    },
  };
}

async function get_function_page(payload: Record<string, unknown> = {}) {
  return getFunctionPage(payload);
}

async function getComicListSceneBundle() {
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
      }),
    },
  };
}

async function getRankingFilterBundle() {
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

async function getAdvancedSearchScheme(
  payload: { extern?: Record<string, unknown> } = {},
) {
  const extern = toStringMap(payload.extern);
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
      ],
    },
    data: {
      values: {
        sortBy: toNum(extern.sortBy, 1),
      },
    },
  };
}

async function get_advanced_search_scheme() {
  return getAdvancedSearchScheme();
}

async function getWeekRankingFilterBundle() {
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

async function getTimeRankingFilterBundle(payload: { tag?: string } = {}) {
  const tag = String(payload.tag ?? "").trim();
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

async function clearPluginSession() {
  await Promise.all([
    pluginConfig.save("auth.account", JSON.stringify("")),
    pluginConfig.save("auth.password", JSON.stringify("")),
    pluginConfig.save("auth.jwt", JSON.stringify("")),
    pluginConfig.save("auth.userInfo", JSON.stringify({})),
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

  const path = `${Config.baseUrl}/album`;

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
    related_list: Array.isArray(response.related_list)
      ? response.related_list
      : [],
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
      title: normalizedInfo.name,
      titleMeta: [
        createActionItem(`浏览：${toNum(normalizedInfo.total_views)}`),
        createActionItem(`更新时间：${timestampToIso(normalizedInfo.addtime)}`),
        createActionItem(
          `章节数：${normalizedInfo.series.length > 0 ? normalizedInfo.series.length : 1}`,
        ),
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
        onTap: {},
        extension: {},
      },
      description: normalizedInfo.description,
      cover: createImage({
        id: String(normalizedInfo.id),
        url: buildJmCoverUrl(normalizedInfo),
        path: `${normalizedInfo.id}.jpg`,
        extension: {},
      }),
      metadata: [
        createMetadataActionList(
          "author",
          "作者",
          normalizedInfo.author,
          (item) =>
            createActionItem(
              item,
              openSearchAction({ source: JM_PLUGIN_ID, keyword: item }),
            ),
        ),
        createMetadataActionList("tags", "标签", normalizedInfo.tags, (item) =>
          createActionItem(
            item,
            openSearchAction({ source: JM_PLUGIN_ID, keyword: item }),
          ),
        ),
        createMetadataActionList(
          "works",
          "作品",
          normalizedInfo.works,
          (item) =>
            createActionItem(
              item,
              openSearchAction({ source: JM_PLUGIN_ID, keyword: item }),
            ),
        ),
        createMetadataActionList(
          "actors",
          "角色",
          normalizedInfo.actors,
          (item) =>
            createActionItem(
              item,
              openSearchAction({ source: JM_PLUGIN_ID, keyword: item }),
            ),
        ),
      ].filter(Boolean),
      extension: {},
    },
    eps: (() => {
      const mapped = normalizedInfo.series.map((item: any) => ({
        id: String(item?.id ?? ""),
        name: String(item?.name ?? ""),
        order: toNum(item?.order, 0),
        extension: {
          sort: toNum(item?.rawOrder, toNum(item?.sort, 0)),
        },
      }));

      if (mapped.length > 0) {
        return mapped;
      }

      return [
        {
          id: String(normalizedInfo.id),
          name: "第1话",
          order: 1,
          extension: {
            sort: 1,
          },
        },
      ];
    })(),
    recommend: (normalizedInfo.related_list as any[]).map((item: any) => {
      const unifiedItem = toComicItem(item);
      return {
        source: JM_PLUGIN_ID,
        id: String(item?.id ?? ""),
        title: String(item?.name ?? ""),
        cover: createImage({
          id: String(item?.id ?? ""),
          url: buildJmCoverUrl(item),
          path: `${String(item?.id ?? "")}.jpg`,
          extension: {},
        }),
        extension: {
          unifiedItem,
        },
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
    extension: {},
  };

  const scheme = {
    version: "1.0.0",
    type: "comicDetail",
    source: JM_PLUGIN_ID,
  };

  const data = {
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

async function searchComic(payload: JmSearchPayload = {}) {
  const extern = toStringMap(payload.extern);
  const page = Math.max(1, toNum(payload.page, 1));
  const keyword = String(payload.keyword ?? extern.keyword ?? "").trim();
  const keywordLower = keyword.toLowerCase();
  const order = String(extern.sort ?? sortByToOrder(extern.sortBy)).trim();
  const path =
    String(payload.path ?? extern.path ?? "").trim() ||
    `${Config.baseUrl}/search`;
  const searchPageSize = 80;
  const buildResult = (content: any[], total: number) => {
    const scheme = {
      version: "1.0.0",
      type: "searchResult",
      source: JM_PLUGIN_ID,
      list: "comicGrid",
    };

    const data = {
      paging: {
        page,
        pages: page,
        total,
        hasReachedMax:
          content.length === 0 ||
          content.length < searchPageSize ||
          (total > 0 && (page - 1) * searchPageSize + content.length >= total),
      },
      items: content.map((item: any) => toComicItem(item)),
    };

    return {
      source: JM_PLUGIN_ID,
      extern: {
        ...extern,
        sortBy: toNum(extern.sortBy, 1),
      },
      scheme,
      data,
      paging: data.paging,
      items: data.items,
    };
  };

  if ((Number(keyword) >= 100 || keywordLower.startsWith("jm")) && page === 1) {
    const comicId = keywordLower.startsWith("jm")
      ? keyword.slice(2).trim()
      : keyword;
    if (comicId) {
      try {
        const detailResponse = await getComicDetail({
          comicId,
          useJwt: payload.useJwt,
          jwtToken: payload.jwtToken,
        });
        const comicInfo = detailResponse?.data?.raw?.comicInfo as
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
      } catch (_error) {
        // ignore direct-id fallback failure and continue with normal search
      }
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
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  })) as Record<string, any>;

  const content = Array.isArray(response.content) ? response.content : [];

  return buildResult(content, toNum(response.total, content.length));
}

function buildHomeSectionAction(section: any) {
  const title = String(section?.title ?? "");
  const id = toNum(section?.id);

  if (title.includes("推荐")) {
    return openComicListAction(
      buildComicListScene({
        title,
        list: {
          fnPath: "getPromoteListData",
          core: {
            id,
            path: `${Config.baseUrl}/promote_list`,
          },
          extern: {
            source: "promoteList",
          },
        },
      }),
    );
  }
  if (title === "连载更新→右滑看更多→") {
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
  if (title === "禁漫汉化组") {
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
  if (title === "韩漫更新") {
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
  if (title === "其他更新") {
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

async function getHomeRecommendData(payload: JmHomePayload = {}) {
  const extern = toStringMap(payload.extern);
  const promotePath =
    String(payload.path ?? extern.promotePath ?? "").trim() ||
    `${Config.baseUrl}/promote?page=0`;

  const promote = await jmRequest({
    path: promotePath,
    method: "GET",
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  const sections = (Array.isArray(promote) ? promote : [])
    .filter((section: any) => {
      const title = String(section?.title ?? "");
      return (
        title !== "禁漫书库" &&
        title !== "禁漫去码&全彩化" &&
        title !== "禁漫小说"
      );
    })
    .map((section: any) => ({
      id: String(section?.id ?? ""),
      title: normalizeHomeSectionTitle(section?.title),
      subtitle: "",
      action: buildHomeSectionAction(section),
      body: {
        type: "comic-list",
        direction: "horizontal",
        key: "items",
      },
      items: (Array.isArray(section?.content) ? section.content : []).map(
        toComicItem,
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

async function getHomeLatestData(payload: JmHomePayload = {}) {
  const extern = toStringMap(payload.extern);
  const page = Number.isFinite(Number(payload.page)) ? Number(payload.page) : 0;
  const path =
    String(payload.path ?? extern.suggestionPath ?? "").trim() ||
    `${Config.baseUrl}/latest`;
  const suggestion = await jmRequest({
    path,
    method: "GET",
    params: { page: Math.max(0, page) },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  const suggestionItems = (Array.isArray(suggestion) ? suggestion : []).map(
    toComicItem,
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

async function getHomeData(payload: JmHomePayload = {}) {
  const page = Number.isFinite(Number(payload.page))
    ? Number(payload.page)
    : -1;
  const scheme = {
    version: "1.0.0",
    type: "page",
    title: "禁漫首页",
    body: {
      type: "list",
      direction: "vertical",
      children: [
        {
          type: "comic-section-list",
          key: "sections",
        },
        {
          type: "comic-grid",
          key: "suggestionItems",
          title: "最新上传",
        },
      ],
    },
  };

  if (page <= -1) {
    const [recommend, latest] = await Promise.all([
      getHomeRecommendData(payload),
      getHomeLatestData({ ...payload, page: 0 }),
    ]);
    return {
      source: JM_PLUGIN_ID,
      extern: payload.extern ?? null,
      scheme,
      data: {
        page,
        sections: (recommend as any)?.data?.sections ?? [],
        suggestionItems: (latest as any)?.data?.suggestionItems ?? [],
        hasReachedMax: Boolean((latest as any)?.data?.hasReachedMax),
      },
    };
  }

  const latest = await getHomeLatestData({ ...payload, page });
  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme,
    data: {
      page,
      sections: [],
      suggestionItems: (latest as any)?.data?.suggestionItems ?? [],
      hasReachedMax: Boolean((latest as any)?.data?.hasReachedMax),
    },
  };
}

async function getRankingData(payload: JmRankingPayload = {}) {
  const page = Number.isFinite(Number(payload.page)) ? Number(payload.page) : 0;
  const extern = toStringMap(payload.extern);
  const c = String(extern.type ?? extern.c ?? "");
  const o = String(extern.order ?? extern.o ?? "");
  const path = `${Config.baseUrl}/categories/filter`;
  const rankingPageSize = 80;

  const raw = await jmRequest({
    path,
    method: "GET",
    params: { page, c, o },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  const total = toNum((raw as any)?.total, 0);
  const content = Array.isArray((raw as any)?.content)
    ? (raw as any).content
    : [];
  const loadedCount = Math.max(0, page - 1) * rankingPageSize + content.length;
  const hasReachedMax =
    content.length === 0 ||
    content.length < rankingPageSize ||
    (total > 0 && loadedCount >= total);

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
      items: content.map((item: any) => toComicItem(item)),
      raw,
    },
  };
}

async function getPromoteListData(payload: JmPromoteListPayload = {}) {
  const id = toNum(payload.id, 0);
  const page = Math.max(0, toNum(payload.page, 0));
  const path = `${Config.baseUrl}/promote_list`;
  const pageSize = 80;

  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { id, page },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  })) as Record<string, any>;

  const total = toNum(raw.total, 0);
  const list = Array.isArray(raw.list) ? raw.list : [];
  const loadedCount = Math.max(0, page - 1) * pageSize + list.length;
  const hasReachedMax =
    list.length === 0 ||
    list.length < pageSize ||
    (total > 0 && loadedCount >= total);

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
      items: list.map((item: any) => toComicItem(item)),
      raw,
    },
  };
}

async function getRecommendData(payload: JmPromoteListPayload = {}) {
  const recommend = await getHomeRecommendData({
    path: undefined,
    useJwt: payload.useJwt,
    jwtToken: payload.jwtToken,
  });

  const sections = Array.isArray((recommend as any)?.data?.sections)
    ? (recommend as any).data.sections
    : [];
  const topSection = sections.find(
    (section: any) =>
      Array.isArray(section?.items) &&
      section.items.length > 0 &&
      String(section?.title ?? "").trim().length > 0,
  );
  const items = Array.isArray(topSection?.items) ? topSection.items : [];

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "recommendFeed",
      card: "comic",
    },
    data: {
      page: 1,
      hasReachedMax: true,
      items,
      raw: recommend,
    },
  };
}

async function getLatestData(payload: JmRankingPayload = {}) {
  const page = Math.max(1, toNum(payload.page, 1));
  if (page == 1) {
    const latest = await getHomeLatestData({
      page: 0,
      path: undefined,
      useJwt: payload.useJwt,
      jwtToken: payload.jwtToken,
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
  const path = `${Config.baseUrl}/latest`;
  const pageSize = 80;
  const raw = await jmRequest({
    path,
    method: "GET",
    params: { page: requestPage },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

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
      items: list.map((item: any) => toComicItem(item)),
      raw,
    },
  };
}

async function getCloudFavoriteData(payload: JmCloudFavoritePayload = {}) {
  const page = Math.max(1, toNum(payload.page, 1));
  const extern = toStringMap(payload.extern);
  const folderId = String(payload.folderId ?? extern.folderId ?? "");
  const order = String(payload.order ?? extern.order ?? "mr") || "mr";
  const path = `${Config.baseUrl}/favorite`;
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page, folder_id: folderId, o: order },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
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
      items: list.map((item: any) => toComicItem(item)),
      raw,
    },
  };
}

async function toggleLike(payload: JmLikePayload = {}) {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const currentLiked = toBool(payload.currentLiked, false);
  if (currentLiked) {
    return {
      liked: true,
      message: "JM 暂不支持取消点赞",
    };
  }

  const path = `${Config.baseUrl}/like`;
  await jmRequest({
    path,
    method: "POST",
    formData: { id: comicId },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  return {
    liked: true,
  };
}

async function toggleFavorite(payload: JmToggleFavoritePayload = {}) {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const path = `${Config.baseUrl}/favorite`;
  await jmRequest({
    path,
    method: "POST",
    formData: { aid: comicId },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  const favorited = !toBool(payload.currentFavorite, false);
  return {
    favorited,
    nextStep: favorited ? "selectFolder" : "none",
  };
}

async function listFavoriteFolders(payload: JmFavoriteFolderPayload = {}) {
  const path = `${Config.baseUrl}/favorite`;
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page: 1, folder_id: "", o: "mr" },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  })) as Record<string, any>;

  const folders = Array.isArray(raw.folder_list) ? raw.folder_list : [];
  return {
    items: folders.map((item: any) => ({
      id: String(item?.FID ?? ""),
      name: String(item?.name ?? ""),
    })),
  };
}

async function moveFavoriteToFolder(payload: JmFavoriteFolderPayload = {}) {
  const comicId = String(payload.comicId ?? "").trim();
  const folderId = String(payload.folderId ?? "").trim();
  const folderName = String(payload.folderName ?? "").trim();
  if (!comicId || !folderId) {
    throw new Error("comicId 或 folderId 不能为空");
  }

  const path = `${Config.baseUrl}/favorite_folder`;
  await jmRequest({
    path,
    method: "POST",
    formData: {
      type: "move",
      folder_id: folderId,
      folder_name: folderName,
      aid: comicId,
    },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
  });

  return {
    ok: true,
  };
}

function buildJmUserCover(photo: unknown): string {
  const file = String(photo ?? "").trim();
  if (!file) {
    return "";
  }
  if (file.startsWith("http://") || file.startsWith("https://")) {
    return file;
  }
  return `${Config.imagesUrl}/media/users/${file}`;
}

function mapJmReplyItem(item: any) {
  const id = String(item?.CID ?? "");
  const photo = String(item?.photo ?? "").trim();
  return {
    id,
    author: {
      name: String(item?.nickname ?? item?.username ?? "匿名用户"),
      avatar: {
        url: buildJmUserCover(photo),
        path: photo ? `${String(item?.UID ?? "")}.jpg` : "",
        extern: {
          path: photo ? `${String(item?.UID ?? "")}.jpg` : "",
        },
      },
    },
    content: stripHtmlTags(item?.content),
    createdAt: formatDisplayTime(item?.addtime),
    extern: {
      commentId: id,
    },
  };
}

function mapJmCommentItem(item: any) {
  const id = String(item?.CID ?? "");
  const photo = String(item?.photo ?? "").trim();
  const replies = Array.isArray(item?.replys) ? item.replys : [];
  return {
    id,
    author: {
      name: String(item?.nickname ?? item?.username ?? "匿名用户"),
      avatar: {
        url: buildJmUserCover(photo),
        path: photo ? `${String(item?.UID ?? "")}.jpg` : "",
        extern: {
          path: photo ? `${String(item?.UID ?? "")}.jpg` : "",
        },
      },
    },
    content: stripHtmlTags(item?.content),
    createdAt: formatDisplayTime(item?.addtime),
    replyCount: replies.length,
    replies: replies.map((reply: any) => mapJmReplyItem(reply)),
    extern: {
      commentId: id,
    },
  };
}

async function getCommentFeed(payload: JmCommentFeedPayload = {}) {
  const comicId = String(payload.comicId ?? "").trim();
  const page = Math.max(1, toNum(payload.page, 1));
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const path = `${Config.baseUrl}/forum`;
  const raw = (await jmRequest({
    path,
    method: "GET",
    params: { page, mode: "manhua", aid: comicId },
    cache: false,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
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
        page,
        hasReachedMax,
      },
      topItems: [],
      items: list.map((item: any) => mapJmCommentItem(item)),
    },
  };
}

async function getWeekRankingData(payload: JmWeekRankingPayload = {}) {
  const date = toNum(payload.date, 0);
  const type = String(payload.type ?? "all");
  const page = Math.max(1, toNum(payload.page, 1));
  const path = `${Config.baseUrl}/serialization`;
  const pageSize = 80;

  const raw = await jmRequest({
    path,
    method: "GET",
    params: { date, type, page },
    cache: true,
    useJwt: payload.useJwt ?? true,
    jwtToken: payload.jwtToken,
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
      items: list.map((item: any) => toComicItem(item)),
      raw,
    },
  };
}

async function getChapter(payload: JmChapterPayload = {}) {
  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) {
    throw new Error("chapterId 不能为空");
  }

  const path = `${Config.baseUrl}/chapter`;
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
  const imageBase = String(Config.imagesUrl).trim();
  const docs = images.map((image) => ({
    name: String(image ?? ""),
    path: String(image ?? ""),
    url: imageBase
      ? `${imageBase}/media/photos/${chapterId}/${String(image ?? "")}`
      : "",
    id: String(image ?? ""),
  }));

  return {
    source: JM_PLUGIN_ID,
    comicId: String(payload.comicId ?? ""),
    chapterId,
    extern: payload.extern ?? null,
    scheme: {
      version: "1.0.0",
      type: "chapterContent",
      source: JM_PLUGIN_ID,
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

async function getReadSnapshot(payload: JmReadSnapshotPayload = {}) {
  const comicId = String(payload.comicId ?? "").trim();
  if (!comicId) {
    throw new Error("comicId 不能为空");
  }

  const externInput = toStringMap(payload.extern);
  const detailPath = String(externInput.path ?? "").trim();
  const detailUseJwt =
    externInput.useJwt === undefined
      ? undefined
      : toBool(externInput.useJwt, true);
  const detailJwtToken = String(externInput.jwtToken ?? "").trim();

  const detail = await getComicDetail({
    comicId,
    extern: payload.extern,
    path: detailPath || undefined,
    useJwt: detailUseJwt,
    jwtToken: detailJwtToken || undefined,
  });
  const normal = (detail as any)?.data?.normal ?? (detail as any)?.normal ?? {};

  const chapterRefs = (Array.isArray(normal?.eps) ? normal.eps : []).map(
    (ep: any) => {
      const id = String(ep?.id ?? "");
      const order = toNum(ep?.order, 0);
      return {
        id,
        name: String(ep?.name ?? ""),
        order,
        extern: {
          sort: toNum(ep?.extension?.sort, order),
          ...toStringMap(ep?.extension),
        },
      };
    },
  );

  let chapterId = String(payload.chapterId ?? "").trim();
  const order = toNum(externInput.order, 0);
  if (!chapterId && order > 0) {
    const found = chapterRefs.find(
      (item: any) => toNum(item?.order, 0) === order,
    );
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
    path: detailPath || undefined,
    useJwt: detailUseJwt,
    jwtToken: detailJwtToken || undefined,
  });
  const chapterData =
    (chapterBundle as any)?.data?.chapter ??
    (chapterBundle as any)?.chapter ??
    {};
  const pages = (Array.isArray(chapterData?.docs) ? chapterData.docs : []).map(
    (doc: any) => ({
      id: String(doc?.id ?? ""),
      name: String(doc?.name ?? doc?.originalName ?? ""),
      path: String(doc?.path ?? ""),
      url: String(doc?.url ?? doc?.fileServer ?? ""),
      extern: {},
    }),
  );

  const currentChapter = chapterRefs.find(
    (item: any) => String(item.id) === String(chapterId),
  ) ??
    chapterRefs.find((item: any) => toNum(item?.order, 0) === order) ?? {
      id: String(chapterData?.epId ?? chapterId),
      name: String(chapterData?.epName ?? ""),
      order: order > 0 ? order : 1,
      extern: {},
    };

  const comicInfo = normal?.comicInfo ?? {};

  return {
    source: JM_PLUGIN_ID,
    extern: payload.extern ?? null,
    data: {
      comic: {
        id: String(comicInfo?.id ?? comicId),
        source: JM_PLUGIN_ID,
        title: String(comicInfo?.title ?? ""),
        description: String(comicInfo?.description ?? ""),
        cover: {
          ...(comicInfo?.cover ?? {}),
          extern: toStringMap(comicInfo?.cover?.extension),
        },
        creator: {
          ...(comicInfo?.creator ?? {}),
          avatar: {
            ...(comicInfo?.creator?.avatar ?? {}),
            extern: toStringMap(comicInfo?.creator?.avatar?.extension),
          },
          extern: toStringMap(comicInfo?.creator?.extension),
        },
        titleMeta: (Array.isArray(comicInfo?.titleMeta)
          ? comicInfo.titleMeta
          : []
        ).map((item: any) => ({
          name: String(item?.name ?? ""),
          onTap: toStringMap(item?.onTap),
          extern: toStringMap(item?.extension),
        })),
        metadata: (Array.isArray(comicInfo?.metadata)
          ? comicInfo.metadata
          : []
        ).map((meta: any) => ({
          type: String(meta?.type ?? ""),
          name: String(meta?.name ?? ""),
          value: (Array.isArray(meta?.value) ? meta.value : []).map(
            (item: any) => ({
              name: String(item?.name ?? ""),
              onTap: toStringMap(item?.onTap),
              extern: toStringMap(item?.extension),
            }),
          ),
        })),
        extern: toStringMap(comicInfo?.extension),
      },
      chapter: {
        id: String(chapterData?.epId ?? currentChapter.id),
        name: String(chapterData?.epName ?? currentChapter.name),
        order: toNum(currentChapter.order, 0),
        pages,
        extern: {},
      },
      chapters: chapterRefs,
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
  get_function_page,
  getCloudFavoriteFilterBundle,
  getCloudFavoriteSceneBundle,
  get_cloud_favorite_scene_bundle,
  getRankingFilterBundle,
  getAdvancedSearchScheme,
  get_advanced_search_scheme,
  getWeekRankingFilterBundle,
  getTimeRankingFilterBundle,
  clearPluginSession,
  dumpRuntimeInfo,
  getHomeData,
  getHomeRecommendData,
  getHomeLatestData,
  getRankingData,
  getPromoteListData,
  getRecommendData,
  getLatestData,
  getCloudFavoriteData,
  getCommentFeed,
  toggleLike,
  toggleFavorite,
  listFavoriteFolders,
  moveFavoriteToFolder,
  getWeekRankingData,
  searchComic,
  getChapter,
  getReadSnapshot,
  fetchImageBytes,
  getFastestUrlIndex,
};
