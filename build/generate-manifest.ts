import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildManifestInfo } from "../src/get-info";

async function main() {
  const manifest = buildManifestInfo();
  const manifestPath = resolve(process.cwd(), "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  console.log(`[manifest] generated: ${manifestPath}`);
}

void main().catch((error) => {
  console.error("[manifest] generate failed:", error);
  process.exit(1);
});
