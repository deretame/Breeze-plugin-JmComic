/**
 * 禁漫「标签组合」搜索的纯逻辑层.
 *
 * 为什么需要它(实测 2026-10, 禁漫移动端 API):
 * - /search 只认 c(单个分类 slug)与 main_tag(0站内/1作品/2作者/3标签);
 *   c[] / tags[] / tag[] / t= 全部无效, 多关键词之间是 OR.
 * - 也就是说服务端没有"同时命中多个条件"的能力, 只能客户端做:
 *   分别拉每个条件的结果集求交集, 再逐本核对兜底.
 *
 * 本模块只放纯计算, 不碰网络, 方便单测.
 */

/** 归一化: 去空白 + 小写. 繁简转换由调用方先做完再传进来. */
export type TagNormalizer = (value: string) => string;

/** 标签分组(禁漫 /categories 的 blocks: 主题A漫 / 角色扮演 / 特殊PLAY / 其他) */
export type JmTagGroup = {
  title: string;
  tags: string[];
};

export type JmTagTaxonomy = {
  groups: JmTagGroup[];
  /** 去重后的全部标签 */
  tags: string[];
  /** 分类(对应搜索接口的 c 参数, 取值是 slug) */
  categories: { label: string; value: string }[];
};

/** 逐本核对时用到的本子字段 */
export type AlbumSearchFields = {
  name?: string;
  author?: string[];
  tags?: string[];
  works?: string[];
  actors?: string[];
};

/**
 * 常用标签.
 *
 * 禁漫 /categories 只给 47 个"主题标签"(剧情向/校园/巨乳...),
 * 而本子实际挂的标签有近 900 个, 后宫/中出/校服 这些高频标签都不在主题列表里.
 * 这份清单是按真实采样(1400+ 本子)的出现频次挑出来的常用项,
 * 补进选择器, 免得用户只能靠手打.
 */
export const JM_COMMON_TAGS: string[] = [
  "中文",
  "巨乳",
  "口交",
  "全彩",
  "群交",
  "中出",
  "剧情向",
  "CG集",
  "后宫",
  "人妻",
  "熟女",
  "兽交",
  "校园",
  "青年漫",
  "NTR",
  "阿黑颜",
  "过膝袜",
  "肛交",
  "萝莉",
  "AI绘图",
  "透视",
  "SM",
  "乱伦",
  "束缚",
  "校服",
  "无修正",
  "接吻",
  "催眠",
  "多重口交",
  "手淫",
  "乳交",
  "重口",
  "怀孕",
  "双马尾",
  "爱情",
  "性玩具",
  "巨尻",
  "韩漫",
  "调教",
  "项圈",
  "手套",
  "眼镜",
  "单行本",
  "泳装",
  "美漫",
  "黑肉",
  "强暴",
  "怪物女孩",
  "口交脸",
  "兽耳",
  "连载中",
  "出轨",
  "女性支配",
  "扶他",
  "马尾",
  "超乳",
  "百合",
  "乳汁",
  "大乳晕",
  "3D",
  "辣妹",
  "多毛",
  "潮吹",
  "连裤袜",
  "遮眼",
  "C108",
  "露出",
  "纯口交",
  "颜射",
  "穿刺",
  "舔阴",
  "毛绒绒",
  "舔肛",
  "乳环",
  "吸奶",
  "触手",
  "兔女郎",
  "处女",
  "出产",
  "足交",
  "饮精",
  "搞笑",
  "猎奇",
  "CG",
  "短髮",
  "非H",
];

/**
 * 少数体系标签和本子实际挂的标签对不上, 搜索时要用别名.
 * 自慰 -> 手淫: 禁漫体系里叫"自慰", 本子标签实际写的是"手淫".
 */
export const JM_TAG_ALIASES: Record<string, string> = {
  自慰: "手淫",
};

/**
 * 写法有出入的标签: 同一个意思, 本子上可能写成别的字.
 * 全彩: 禁漫本子有时写"全採"(异体字), 严格比对会漏掉.
 */
export const JM_TAG_VARIANTS: Record<string, string[]> = {
  全彩: ["全采"],
};

/** 取标签的检索用别名(没有别名就是原值). */
export function resolveTagQueryTerm(tag: string): string {
  const key = String(tag ?? "").trim();
  return JM_TAG_ALIASES[key] ?? key;
}

/** 解析 /categories 的响应, 取出标签分组与标签全集. */
export function parseTagTaxonomy(raw: unknown): JmTagTaxonomy {
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const blocks = Array.isArray(body.blocks) ? body.blocks : [];
  const groups: JmTagGroup[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    const title = String(record.title ?? "").trim();
    const content = Array.isArray(record.content) ? record.content : [];
    const tags: string[] = [];

    for (const item of content) {
      const tag = String(item ?? "").trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tags.push(tag);
    }

    if (tags.length > 0) {
      groups.push({ title, tags });
    }
  }

  const categories: { label: string; value: string }[] = [];
  const rawCategories = Array.isArray(body.categories) ? body.categories : [];
  for (const item of rawCategories) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const label = String(record.name ?? "").trim();
    const value = String(record.slug ?? "").trim();
    if (!label || !value) continue;
    categories.push({ label, value });
  }

  return { groups, tags: groups.flatMap((group) => group.tags), categories };
}

/**
 * 按加号拆关键词: "后宫+校园" -> ["后宫", "校园"].
 *
 * 不做词表校验: 主题标签表里根本没有"后宫"这类高频标签, 校验了反而识别不出.
 * 拆出来的条件最终由"逐本核对"兜底, 认不出来就当普通搜索(见调用方回退逻辑).
 */
export function splitTagTerms(keyword: string): string[] {
  const text = String(keyword ?? "").trim();
  if (!text) {
    return [];
  }
  const parts = text
    .split(/[+＋]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [text];
}

/** 多个 id 列表求交集, 结果保持第一个列表的顺序. */
export function intersectIdLists(lists: string[][]): string[] {
  if (!lists.length) {
    return [];
  }
  const [head, ...rest] = lists;
  const sets = rest.map((list) => new Set(list));
  return head.filter((id) => sets.every((set) => set.has(id)));
}

/**
 * 本子标签是否覆盖全部目标标签.
 *
 * 用"互相包含"而不是严格相等: 禁漫本子的标签常带后缀
 * (体系"近亲" vs 本子"近亲相姦"), 严格相等会漏.
 */
export function albumHasAllTags(
  albumTags: string[],
  wanted: string[],
  normalize: TagNormalizer,
): boolean {
  if (!wanted.length) {
    return true;
  }
  const owned = albumTags
    .map((tag) => normalize(tag))
    .filter((tag) => tag.length > 0);
  return wanted.every((tag) => {
    const key = normalize(tag);
    if (!key) return true;
    const keys = [key, ...(JM_TAG_VARIANTS[key] ?? []).map((v) => normalize(v))];
    return owned.some((item) =>
      keys.some((k) => item === k || item.includes(k) || k.includes(item)),
    );
  });
}

/** 本子是否命中某个条件词: 标签命中算, 标题/作者/作品/角色里出现也算. */
export function albumMatchesTerm(
  album: AlbumSearchFields,
  term: string,
  normalize: TagNormalizer,
): boolean {
  const key = normalize(String(term ?? "").trim());
  if (!key) {
    return true;
  }
  if (albumHasAllTags(album.tags ?? [], [term], normalize)) {
    return true;
  }
  const haystack = [
    album.name ?? "",
    ...(album.author ?? []),
    ...(album.works ?? []),
    ...(album.actors ?? []),
  ]
    .map((item) => normalize(item))
    .join(" ");
  return haystack.includes(key);
}

/** 固定并发跑一批异步任务, 保持结果顺序. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[];
  const size = Math.max(1, Math.floor(limit) || 1);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}
