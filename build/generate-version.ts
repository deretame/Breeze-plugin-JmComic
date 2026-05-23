import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const infoPath = new URL("../src/get-info.ts", import.meta.url);
  const info = await readFile(infoPath, "utf-8");
  const match = info.match(/version:\s*"([^"]*)"/);
  if (!match) {
    throw new Error("version not found in src/get-info.ts");
  }
  const version = match[1];

  const pkgPath = new URL("../package.json", import.meta.url);
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
  pkg.version = version;
  await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
  console.log(`[version] synced package.json <- src/get-info.ts -> ${version}`);
}

void main().catch((error) => {
  console.error("[version] generate failed:", error);
  process.exit(1);
});
