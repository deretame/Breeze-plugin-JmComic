/**
 * 进程内缓存，塞什么出来就是什么。
 *
 * @example
 *   await cache.set("foo", { x: 1 });
 *   const got = await cache.get<{ x: number }>("foo", null);  // { x: 1 }
 */
export const cache = {
  get: <T = unknown>(key: string, fallback: T = null as T): Promise<T> =>
    bridge.call("cache.get", key, fallback) as Promise<T>,
  getSync: (key: string, fallback: unknown = null): unknown =>
    bridge.callSync("cache.get.sync", key, fallback),
  set: (key: string, value: unknown) =>
    bridge.call("cache.set", key, value) as Promise<boolean>,
  setSync: (key: string, value: unknown): boolean =>
    bridge.callSync("cache.set.sync", key, value) as boolean,
  setIfAbsent: (key: string, value: unknown) =>
    bridge.call("cache.set_if_absent", key, value) as Promise<boolean>,
  compareAndSet: (key: string, expected: unknown, next: unknown) =>
    bridge.call(
      "cache.compare_and_set",
      key,
      expected,
      next,
    ) as Promise<boolean>,
  delete: (key: string) => bridge.call("cache.delete", key) as Promise<boolean>,
};

export const pluginConfig = {
  /**
   * 持久化配置存储：保存配置。
   * * Dart 端会对 value 尝试 `jsonDecode`，
   * 成功后以解码后的值存入 ObjectBox（失败则存原字符串）。
   *
   * @example
   * ```ts
   * // 存简单字符串 — JSON 可解析，存为字符串值
   * await pluginConfig.save("site", "EH");
   *
   * // 存 JSON 对象 — jsonDecode 后存为 Map
   * await pluginConfig.save("opts", '{"a":1}');
   * ```
   * @param key 配置键名
   * @param value 要保存的值（可以是 JSON 字符串）
   */
  save: (key: string, value: string) =>
    bridge.call("save_plugin_config", key, value) as Promise<string>,

  /**
   * 持久化配置存储：读取配置。
   * * 返回 `'{"ok":true,"value":...}'` 格式的 JSON 字符串。
   * 需要 `JSON.parse` 一层拿到 `{ ok, value }`，再取 `.value`。
   *
   * @example
   * ```ts
   * const raw = await pluginConfig.load("site", "EH");
   * const { value } = JSON.parse(raw);  // "EH"
   * ```
   * @param key 配置键名
   * @param fallback 找不到键时的默认返回值，默认为 ""
   */
  load: (key: string, fallback = "") =>
    bridge.call("load_plugin_config", key, fallback) as Promise<string>,
};

export const runtime = {
  gc: () => bridge.call("runtime.gc") as Promise<void>,
  isTaskGroupCancelled: (taskGroupKey: string) =>
    bridge.call(
      "runtime.is_task_group_cancelled",
      taskGroupKey,
    ) as Promise<boolean>,
};

export const opencc = {
  convert: (
    text: string,
    config:
      | "s2t.json"
      | "t2s.json"
      | "s2tw.json"
      | "tw2s.json"
      | "s2hk.json"
      | "hk2s.json",
  ) => {
    return bridge.call("opencc.convert", { text, config }) as Promise<string>;
  },
};

interface ToastOptions {
  message: string;
  title?: string;
  seconds?: number;
  level?: "info" | "success" | "warning" | "error";
}

export const flutterTools = {
  getAppVersion: () => bridge.call("dart.getAppVersion") as Promise<string>,
  showToast: (options: ToastOptions) => {
    return bridge.call(
      "flutter.showToast",
      JSON.stringify(options),
    ) as Promise<string>;
  },
};
