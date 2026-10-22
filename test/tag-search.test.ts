/**
 * 标签组合搜索的纯逻辑单测.
 *
 * 跑法: node --import tsx test/tag-search.test.ts
 * 不依赖测试框架和网络, 纯离线.
 */
import assert from "node:assert/strict";
import {
  albumHasAllTags,
  albumMatchesTerm,
  intersectIdLists,
  mapWithConcurrency,
  parseTagTaxonomy,
  resolveTagQueryTerm,
  splitTagTerms,
} from "../src/tag-search.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

const norm = (value: string) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

console.log("\n=== splitTagTerms ===");
await test("按加号拆分条件词", () => {
  assert.deepEqual(splitTagTerms("后宫+校园"), ["后宫", "校园"]);
});
await test("去掉空段与空白", () => {
  assert.deepEqual(splitTagTerms(" 后宫 + 校园 "), ["后宫", "校园"]);
});
await test("没有加号时整体当一个条件", () => {
  assert.deepEqual(splitTagTerms("MANA"), ["MANA"]);
});
await test("空关键词返回空数组", () => {
  assert.deepEqual(splitTagTerms("   "), []);
});
await test("全角加号也能拆", () => {
  assert.deepEqual(splitTagTerms("后宫＋校园"), ["后宫", "校园"]);
});

console.log("\n=== parseTagTaxonomy ===");
const taxonomy = parseTagTaxonomy({
  categories: [
    { id: "1", name: "同人", slug: "doujin" },
    { id: "2", name: "单本", slug: "single" },
    { id: "0", name: "最新A漫", slug: "" },
  ],
  blocks: [
    { title: "主题A漫", content: ["剧情向", "校园", "YAOI"] },
    { title: "角色 / 扮演", content: ["巨乳", "校园"] },
  ],
});
await test("解析出标签分组", () => {
  assert.equal(taxonomy.groups.length, 2);
  assert.equal(taxonomy.groups[0]?.title, "主题A漫");
});
await test("标签去重", () => {
  assert.deepEqual(taxonomy.tags, ["剧情向", "校园", "YAOI", "巨乳"]);
});
await test("解析出分类 slug, 丢掉空 slug", () => {
  assert.deepEqual(taxonomy.categories, [
    { label: "同人", value: "doujin" },
    { label: "单本", value: "single" },
  ]);
});
await test("空响应不炸", () => {
  const empty = parseTagTaxonomy(null);
  assert.deepEqual(empty.tags, []);
  assert.deepEqual(empty.categories, []);
});

console.log("\n=== intersectIdLists ===");
await test("求交集并保持第一个列表的顺序", () => {
  assert.deepEqual(
    intersectIdLists([
      ["a", "b", "c"],
      ["c", "a"],
      ["a", "c"],
    ]),
    ["a", "c"],
  );
});
await test("没有交集返回空", () => {
  assert.deepEqual(intersectIdLists([["a"], ["b"]]), []);
});
await test("单个列表原样返回", () => {
  assert.deepEqual(intersectIdLists([["a", "b"]]), ["a", "b"]);
});

console.log("\n=== albumHasAllTags ===");
await test("带齐全部标签", () => {
  assert.equal(albumHasAllTags(["后宫", "校园", "中文"], ["后宫", "校园"], norm), true);
});
await test("缺一个标签就不算", () => {
  assert.equal(albumHasAllTags(["后宫", "中文"], ["后宫", "校园"], norm), false);
});
await test("本子标签带后缀也算命中(近亲 vs 近亲相姦)", () => {
  assert.equal(albumHasAllTags(["近亲相姦", "中文"], ["近亲"], norm), true);
});
await test("大小写无关(YAOI vs yaoi)", () => {
  assert.equal(albumHasAllTags(["yaoi", "中文"], ["YAOI"], norm), true);
});
await test("没有目标标签时全命中", () => {
  assert.equal(albumHasAllTags(["中文"], [], norm), true);
});

console.log("\n=== albumMatchesTerm ===");
await test("标签命中", () => {
  assert.equal(albumMatchesTerm({ tags: ["校园", "中文"] }, "校园", norm), true);
});
await test("作者命中也算", () => {
  assert.equal(
    albumMatchesTerm({ name: "某本", author: ["MANA"], tags: ["中文"] }, "MANA", norm),
    true,
  );
});
await test("作品命中也算", () => {
  assert.equal(
    albumMatchesTerm({ name: "某本", works: ["绝区零"], tags: ["中文"] }, "绝区零", norm),
    true,
  );
});
await test("对不上就不算", () => {
  assert.equal(
    albumMatchesTerm({ name: "某本", author: ["别人"], tags: ["中文"] }, "校园", norm),
    false,
  );
});

console.log("\n=== resolveTagQueryTerm ===");
await test("体系标签有别名时用别名(自慰 -> 手淫)", () => {
  assert.equal(resolveTagQueryTerm("自慰"), "手淫");
});
await test("没有别名时原样返回", () => {
  assert.equal(resolveTagQueryTerm("后宫"), "后宫");
});

console.log("\n=== mapWithConcurrency ===");
await test("保持顺序", async () => {
  const input = [1, 2, 3, 4, 5];
  const out = await mapWithConcurrency(input, 2, async (item) => item * 2);
  assert.deepEqual(out, [2, 4, 6, 8, 10]);
});
await test("并发上限生效", async () => {
  let active = 0;
  let peak = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return item;
  });
  assert.ok(peak <= 2, `峰值并发 ${peak} 超过上限 2`);
});

console.log(`\n========== 通过 ${passed} / 失败 ${failed} ==========`);
if (failed > 0) {
  process.exit(1);
}
