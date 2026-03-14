export {};

export type NativeChainStep = string | { op: string; extraInputId?: number };

export interface FsApi {
  promises: {
    readFile(
      path: string,
      encoding?: string | null,
    ): Promise<Uint8Array | string>;
    writeFile(
      path: string,
      data: string | ArrayBuffer | ArrayBufferView | Uint8Array,
    ): Promise<void>;
    appendFile(
      path: string,
      data: string | ArrayBuffer | ArrayBufferView | Uint8Array,
    ): Promise<void>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    readdir(
      path: string,
      options?: { withFileTypes?: boolean },
    ): Promise<unknown[]>;
    stat(path: string): Promise<unknown>;
    rm(
      path: string,
      options?: { recursive?: boolean; force?: boolean },
    ): Promise<void>;
  };
}

export interface PathApi {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  dirname(path: string): string;
  basename(path: string, suffix?: string): string;
  extname(path: string): string;
  isAbsolute(path: string): boolean;
}

export interface NativeApi {
  chain(
    steps: NativeChainStep[],
    input: Uint8Array | number,
  ): Promise<Uint8Array>;
  gzipDecompress(
    input: Uint8Array | ArrayBuffer | ArrayBufferView,
  ): Promise<Uint8Array>;
  gzipCompress(
    input: Uint8Array | ArrayBuffer | ArrayBufferView,
  ): Promise<Uint8Array>;
  run(
    op: string,
    input: Uint8Array,
    args?: unknown,
    extraInput?: Uint8Array | number,
  ): Promise<Uint8Array>;
  put(input: Uint8Array): Promise<number>;
  free(id: number): Promise<void>;
}

export interface WasiRunResult {
  exitCode: number;
  stdoutId: number;
  stderrId: number;
}

export interface WasiApi {
  run(
    moduleBytes: Uint8Array,
    options?: { stdinId?: number; args?: string[]; reuseModule?: boolean },
  ): Promise<WasiRunResult>;
  runById(
    moduleId: number,
    options?: { stdinId?: number; args?: string[]; reuseModule?: boolean },
  ): Promise<WasiRunResult>;
  takeStdout(result: WasiRunResult): Promise<Uint8Array>;
  takeStderr(result: WasiRunResult): Promise<Uint8Array>;
}

export interface CacheApi {
  set(key: string, value: unknown): unknown;
  setIfAbsent(key: string, value: unknown): boolean;
  compareAndSet(key: string, expected: unknown, value: unknown): boolean;
  get<T = unknown>(key: string): T | unknown;
  get<T>(key: string, fallback: T): T;
  has(key: string): boolean;
  delete(key: string): boolean;
}

export interface BridgeApi {
  gzipDecompress(
    input: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
  ): Promise<Uint8Array>;
  gzipCompress(
    input: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
  ): Promise<Uint8Array>;
  call(name: "crypto.md5_hex", input: string): Promise<string>;
  call(
    name: "crypto.aes_ecb_pkcs7_decrypt_b64",
    payloadB64: string,
    keyRaw: string,
  ): Promise<string>;
  call(
    name: "compression.gzip_decompress",
    input: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
  ): Promise<number[]>;
  call(
    name: "compression.gzip_compress",
    input: Uint8Array | ArrayBuffer | ArrayBufferView | number[],
  ): Promise<number[]>;
  call(name: "save_plugin_config", key: string, value: string): Promise<string>;
  call(name: "load_plugin_config", key: string, value: string): Promise<string>;
  call(
    name: "plugin_config.save_plugin_config",
    key: string,
    value: string,
  ): Promise<string>;
  call(
    name: "plugin_config.load_plugin_config",
    key: string,
    value: string,
  ): Promise<string>;
  call(name: string, ...args: unknown[]): Promise<unknown>;
}

export interface HostPluginConfigApi {
  savePluginConfig(key: string, value: string): Promise<string>;
  loadPluginConfig(key: string, value: string): Promise<string>;
}

export interface HostRuntimeApi {
  bridge: BridgeApi;
  pluginConfig: HostPluginConfigApi;
  [key: string]: unknown;
}

export interface CryptoHash {
  update(
    data: string | ArrayBuffer | ArrayBufferView,
    inputEncoding?: "utf8" | "utf-8" | "hex" | "base64" | "latin1" | "binary",
  ): CryptoHash;
  digest(
    encoding?:
      | "hex"
      | "base64"
      | "latin1"
      | "binary"
      | "utf8"
      | "utf-8"
      | "buffer",
  ): string | Buffer;
}

export interface CryptoApi {
  createHash(algorithm: "sha256" | "sha-256"): CryptoHash;
  createHmac(
    algorithm: "sha256" | "sha-256",
    key: string | ArrayBuffer | ArrayBufferView,
  ): CryptoHash;
  randomBytes(size: number): Buffer;
}

export interface PluginInfo {
  name: string;
  version: string;
  apiVersion: number;
  description?: string;
  [key: string]: unknown;
}

export interface PluginApi {
  register(info: PluginInfo): PluginInfo;
  getInfo(name: string): PluginInfo | null;
  list(): PluginInfo[];
  clear(): void;
}

declare global {
  var __web: HostRuntimeApi;
  var fs: FsApi | undefined;
  var path: PathApi | undefined;
  var plugin: PluginApi | undefined;
  var native: NativeApi;
  var wasi: WasiApi;
  var cache: CacheApi;
  var bridge: BridgeApi;
  var pluginConfig: HostPluginConfigApi;
  var nodeCryptoCompat: CryptoApi;
  var uuidv4: () => string;
}
