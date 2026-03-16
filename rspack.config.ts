import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRspackConfig } from "./rspack.shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getBundleFileName(): string {
  try {
    const raw = readFileSync(resolve(__dirname, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { name?: unknown };
    const packageName =
      typeof pkg.name === "string" && pkg.name.length > 0 ? pkg.name : "bundle";
    return `${packageName}.bundle.cjs`;
  } catch {
    return "bundle.bundle.cjs";
  }
}

const config = createRspackConfig({
  rootDir: __dirname,
  outPath: resolve(__dirname, "dist"),
  outFileName: getBundleFileName(),
});

export default config;
