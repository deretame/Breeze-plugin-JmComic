import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { networkInterfaces } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rspack, type MultiStats, type Stats } from "@rspack/core";
import { createRspackConfig } from "./rspack.shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const bindHost = process.env.BUNDLE_HOST || "0.0.0.0";
const preferredPort = Number(process.env.BUNDLE_PORT || "7878");
let activePort = preferredPort;

const outDir = resolve(__dirname, "dist");
const packageJsonPath = resolve(__dirname, "package.json");
let bundleFileName = "bundle.bundle.cjs";
let bundleRoutePath = `/${bundleFileName}`;
let outFile = resolve(outDir, bundleFileName);

type BuildState = {
  ok: boolean;
  builtAt: string | null;
  sha256: string | null;
  size: number;
  error: string | null;
};

const state: BuildState = {
  ok: false,
  builtAt: null,
  sha256: null,
  size: 0,
  error: null,
};

let rebuildCount = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function toUrlHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function getServerUrl(pathname = "", host = "127.0.0.1"): string {
  return `http://${toUrlHost(host)}:${activePort}${pathname}`;
}

type ListenAddress = {
  interfaceName: string;
  family: string;
  address: string;
  internal: boolean;
};

function toFamilyName(family: string | number): string {
  if (typeof family === "number") {
    return family === 4 ? "IPv4" : family === 6 ? "IPv6" : String(family);
  }
  return family;
}

function getListenAddresses(): ListenAddress[] {
  const interfaces = networkInterfaces();
  const result: ListenAddress[] = [];
  const seen = new Set<string>();

  for (const [interfaceName, values] of Object.entries(interfaces)) {
    if (!values) {
      continue;
    }

    for (const info of values) {
      if (!info?.address) {
        continue;
      }

      const key = `${interfaceName}|${info.address}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push({
        interfaceName,
        family: toFamilyName(info.family),
        address: info.address,
        internal: info.internal,
      });
    }
  }

  return result.sort((a, b) => {
    if (a.interfaceName !== b.interfaceName) {
      return a.interfaceName.localeCompare(b.interfaceName);
    }
    if (a.family !== b.family) {
      return a.family.localeCompare(b.family);
    }
    return a.address.localeCompare(b.address);
  });
}

function printListenEndpoints(): void {
  const listenAddresses = getListenAddresses();
  const bundlePath = bundleRoutePath;
  const logPath = "/log";

  console.error(`[bundle-dev] listening on ${bindHost}:${activePort}`);
  console.error("[bundle-dev] available endpoints (by interface):");
  console.error(
    `[bundle-dev]   [local] bundle: ${getServerUrl(bundlePath, "localhost")}`,
  );
  console.error(
    `[bundle-dev]   [local] log:    ${getServerUrl(logPath, "localhost")}`,
  );

  let currentInterfaceName = "";
  for (const item of listenAddresses) {
    if (item.interfaceName !== currentInterfaceName) {
      currentInterfaceName = item.interfaceName;
      console.error(`[bundle-dev]   [${currentInterfaceName}]`);
    }

    const suffix = item.internal ? " internal" : "";
    console.error(
      `[bundle-dev]     - ${item.family}${suffix} bundle: ${getServerUrl(bundlePath, item.address)}`,
    );
    console.error(
      `[bundle-dev]       log:  ${getServerUrl(logPath, item.address)}`,
    );
  }
}

async function setupBundleNameFromPackageJson(): Promise<void> {
  try {
    const raw = await readFile(packageJsonPath, "utf-8");
    const pkg = JSON.parse(raw) as { name?: unknown };
    const packageName =
      typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : "bundle";

    bundleFileName = `${packageName}.bundle.cjs`;
    bundleRoutePath = `/${bundleFileName}`;
    outFile = resolve(outDir, bundleFileName);
  } catch (err) {
    console.error(
      `[bundle-dev] read package name failed, fallback to '${bundleFileName}': ${String(err)}`,
    );
  }
}

function isAddressInUseError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }

  return Reflect.get(err, "code") === "EADDRINUSE";
}

async function listenWithPortFallback(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  let tryPort = preferredPort;

  while (true) {
    try {
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (err: Error): void => {
          server.off("listening", onListening);
          rejectListen(err);
        };

        const onListening = (): void => {
          server.off("error", onError);
          resolveListen();
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(tryPort, bindHost);
      });

      activePort = tryPort;
      return;
    } catch (err) {
      if (!isAddressInUseError(err)) {
        throw err;
      }

      console.error(
        `[bundle-dev] port ${tryPort} is in use, trying ${tryPort + 1}`,
      );
      tryPort += 1;
    }
  }
}

function formatRspackError(err: unknown): string {
  if (typeof err === "string") {
    return err;
  }

  if (err && typeof err === "object") {
    const message = Reflect.get(err, "message");
    if (typeof message === "string" && message.length > 0) {
      return message;
    }

    const details = Reflect.get(err, "details");
    if (typeof details === "string" && details.length > 0) {
      return details;
    }
  }

  return String(err);
}

function getErrorFromStats(stats: Stats | MultiStats | undefined): string {
  if (!stats) {
    return "build failed";
  }

  const info = stats.toJson({ all: false, errors: true });
  const firstError = info.errors?.[0];
  if (!firstError) {
    return "build failed";
  }

  return formatRspackError(firstError);
}

function createCompiler() {
  return rspack(
    createRspackConfig({
      rootDir: __dirname,
      outPath: outDir,
      outFileName: basename(outFile),
    }),
  );
}

function setCommonHeaders(res: ServerResponse, contentType?: string): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (contentType) {
    res.setHeader("Content-Type", contentType);
  }
}

function getRequestOrigin(req: IncomingMessage): string {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedHost = req.headers["x-forwarded-host"];
  const hostHeader = req.headers.host;

  const proto =
    typeof forwardedProto === "string" && forwardedProto.length > 0
      ? forwardedProto.split(",")[0]!.trim()
      : "http";

  const host =
    typeof forwardedHost === "string" && forwardedHost.length > 0
      ? forwardedHost.split(",")[0]!.trim()
      : typeof hostHeader === "string" && hostHeader.length > 0
        ? hostHeader
        : `127.0.0.1:${activePort}`;

  return `${proto}://${host}`;
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  return await new Promise<string>((resolveBody, rejectBody) => {
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("end", () => {
      resolveBody(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", (err) => {
      rejectBody(err);
    });
  });
}

async function refreshBuildState(): Promise<void> {
  const bytes = await readFile(outFile);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const builtAt = new Date().toISOString();

  state.ok = true;
  state.builtAt = builtAt;
  state.sha256 = sha256;
  state.size = bytes.byteLength;
  state.error = null;

  console.error(
    `[bundle-dev] built sha256=${sha256.slice(0, 12)} size=${bytes.byteLength}`,
  );
}

async function handleBundle(res: ServerResponse): Promise<void> {
  try {
    const bytes = await readFile(outFile);
    setCommonHeaders(res, "application/javascript; charset=utf-8");
    if (state.sha256) {
      res.setHeader("ETag", `"${state.sha256}"`);
    }
    res.setHeader("Cache-Control", "no-cache");
    res.statusCode = 200;
    res.end(bytes);
  } catch (err) {
    setCommonHeaders(res, "text/plain; charset=utf-8");
    res.statusCode = 503;
    res.end(`bundle not ready: ${String(err)}`);
  }
}

function handleDefault(req: IncomingMessage, res: ServerResponse): void {
  const origin = getRequestOrigin(req);
  setCommonHeaders(res, "text/plain; charset=utf-8");
  res.statusCode = 200;
  res.end(
    [
      "bundle dev server is running",
      `bundle: ${origin}${bundleRoutePath}`,
      `log:    ${origin}/log`,
    ].join("\n"),
  );
}

async function handleLog(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (req.method !== "POST") {
    setCommonHeaders(res, "application/json; charset=utf-8");
    res.statusCode = 405;
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return;
  }

  try {
    const rawBody = await readRequestBody(req);
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    const level = String(parsed?.level || "log").toLowerCase();
    const message = parsed?.message;
    const payload = parsed?.payload;

    const text =
      typeof message === "string" && message.length > 0
        ? message
        : JSON.stringify(message ?? "");

    if (level === "error") {
      console.error(`[remote-log] ${text}`, payload ?? "");
    } else if (level === "warn") {
      console.warn(`[remote-log] ${text}`, payload ?? "");
    } else if (level === "info") {
      console.info(`[remote-log] ${text}`, payload ?? "");
    } else {
      console.log(`[remote-log] ${text}`, payload ?? "");
    }

    setCommonHeaders(res, "application/json; charset=utf-8");
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    console.error(`[remote-log] invalid log payload: ${String(err)}`);
    setCommonHeaders(res, "application/json; charset=utf-8");
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        ok: false,
        error: `invalid log payload: ${String(err)}`,
      }),
    );
  }
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    setCommonHeaders(res);
    res.statusCode = 204;
    res.end();
    return;
  }

  const rawUrl = req.url || "/";
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, getServerUrl("/")).pathname;
  } catch {}

  if (pathname === bundleRoutePath) {
    await handleBundle(res);
    return;
  }

  if (pathname === "/log") {
    await handleLog(req, res);
    return;
  }

  handleDefault(req, res);
}

async function start(): Promise<void> {
  await setupBundleNameFromPackageJson();
  await mkdir(outDir, { recursive: true });
  const compiler = createCompiler();

  const watcher = compiler.watch({}, async (err, stats) => {
    rebuildCount += 1;
    const ts = nowIso();

    if (err) {
      state.ok = false;
      state.error = formatRspackError(err);
      console.error(
        `[bundle-dev] [${ts}] rebuild #${rebuildCount} failed: ${state.error}`,
      );
      return;
    }

    if (!stats || stats.hasErrors()) {
      state.ok = false;
      state.error = getErrorFromStats(stats);
      console.error(
        `[bundle-dev] [${ts}] rebuild #${rebuildCount} failed: ${state.error}`,
      );
      return;
    }

    try {
      await refreshBuildState();
      printListenEndpoints();
      console.error(`[bundle-dev] [${ts}] rebuild #${rebuildCount} completed`);
    } catch (refreshErr) {
      state.ok = false;
      state.error = String(refreshErr);
      console.error(
        `[bundle-dev] [${ts}] rebuild #${rebuildCount} read output failed: ${state.error}`,
      );
    }
  });

  const server = createServer((req, res) => {
    const startAt = Date.now();
    res.on("finish", () => {
      const method = req.method || "GET";
      const path = req.url || "/";
      const elapsedMs = Date.now() - startAt;
      console.error(
        `[bundle-dev] ${method} ${path} -> ${res.statusCode} (${elapsedMs}ms)`,
      );
    });
    void route(req, res);
  });

  await listenWithPortFallback(server);
  if (activePort !== preferredPort) {
    console.error(
      `[bundle-dev] requested port ${preferredPort} was unavailable`,
    );
  }
  console.error(`[bundle-dev] watching ${resolve(__dirname, "src")}`);

  const shutdown = async (): Promise<void> => {
    console.error("[bundle-dev] shutting down...");
    server.close();

    await new Promise<void>((resolveClose, rejectClose) => {
      try {
        watcher.close(() => {
          resolveClose();
        });
      } catch (closeErr) {
        rejectClose(closeErr);
      }
    });

    await new Promise<void>((resolveClose, rejectClose) => {
      try {
        compiler.close(() => {
          resolveClose();
        });
      } catch (closeErr) {
        rejectClose(closeErr);
      }
    });

    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

start().catch((err) => {
  console.error(`[bundle-dev] failed to start: ${String(err)}`);
  process.exit(1);
});
