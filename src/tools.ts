export const cache = {
  get: (key: string, fallback: unknown = null): Promise<unknown> =>
    bridge.call("cache.get", key, fallback),
  set: (key: string, value: unknown) =>
    bridge.call("cache.set", key, value) as Promise<boolean>,
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
  save: (key: string, value: string) =>
    bridge.call("save_plugin_config", key, value) as Promise<string>,
  load: (key: string, fallback = "") =>
    bridge.call("load_plugin_config", key, fallback) as Promise<string>,
};
