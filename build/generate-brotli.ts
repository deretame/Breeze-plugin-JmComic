import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { brotliCompress } from "node:zlib";
import { promisify } from "node:util";
import { constants as zlibConstants } from "node:zlib";

const brotliCompressAsync = promisify(brotliCompress);

async function main() {
  const distDir = resolve(process.cwd(), "dist");
  const files = (await readdir(distDir)).filter((file) =>
    file.endsWith(".bundle.cjs"),
  );

  if (files.length === 0) {
    throw new Error(`[brotli] no .bundle.cjs file found in ${distDir}`);
  }

  for (const file of files) {
    const sourcePath = resolve(distDir, file);
    const targetPath = `${sourcePath}.br`;
    const source = await readFile(sourcePath);
    const compressed = await brotliCompressAsync(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
        [zlibConstants.BROTLI_PARAM_SIZE_HINT]: source.length,
      },
    });

    await writeFile(targetPath, compressed);
    const ratio = source.length
      ? ((compressed.length / source.length) * 100).toFixed(2)
      : "0.00";
    console.log(
      `[brotli] generated: ${targetPath} (${source.length} -> ${compressed.length}, ${ratio}%)`,
    );
  }
}

void main().catch((error) => {
  console.error("[brotli] generate failed:", error);
  process.exit(1);
});
