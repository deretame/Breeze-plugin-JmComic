import { parseSync, Visitor } from "oxc-parser";
import type { CallExpression } from "oxc-parser";

const METHODS: Record<string, true> = {
  log: true,
  info: true,
  warn: true,
  error: true,
  debug: true,
  table: true,
  dir: true,
};

function toPosixPath(filePath: string): string {
  return String(filePath || "").replace(/\\/g, "/");
}

function findOpenParen(source: string, from: number, to: number): number {
  const start = Math.max(0, from);
  const end = Math.min(source.length, to);
  for (let i = start; i < end; i += 1) {
    if (source.charCodeAt(i) === 40) {
      return i;
    }
  }
  return -1;
}

/** 每行起始 offset 的数组,用于把字符偏移换算成 1-based 行列。 */
function buildLineStarts(source: string): number[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

function getLineAndCharacterOfPosition(
  lineStarts: number[],
  position: number,
): { line: number; character: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (lineStarts[mid] <= position) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { line: low, character: position - lineStarts[low] };
}

function consoleLocationLoader(this: { resourcePath: string }, source: string): string {
  const filePath = toPosixPath(this.resourcePath);

  if (!filePath.includes("/src/")) {
    return source;
  }

  const { program } = parseSync(this.resourcePath, source, {
    lang: this.resourcePath.endsWith(".tsx") ? "tsx" : "ts",
    sourceType: "unambiguous",
  });

  const lineStarts = buildLineStarts(source);
  const edits: Array<{ index: number; text: string }> = [];

  const visitor = new Visitor({
    CallExpression(node: CallExpression) {
      const { callee } = node;
      if (
        callee.type !== "MemberExpression" ||
        callee.computed ||
        callee.object.type !== "Identifier" ||
        callee.object.name !== "console"
      ) {
        return;
      }

      const method = callee.property.name;
      if (!METHODS[method]) {
        return;
      }

      const { line, character } = getLineAndCharacterOfPosition(lineStarts, node.start);
      const location = `${filePath}:${line + 1}:${character + 1}`;

      const openParen = findOpenParen(source, callee.end, node.end);

      if (openParen >= 0) {
        const insert =
          node.arguments.length > 0 ? `${JSON.stringify(location)}, ` : JSON.stringify(location);
        edits.push({ index: openParen + 1, text: insert });
      }
    },
  });

  visitor.visit(program);

  if (edits.length === 0) {
    return source;
  }

  edits.sort((a, b) => b.index - a.index);
  let output = source;
  for (const edit of edits) {
    output = `${output.slice(0, edit.index)}${edit.text}${output.slice(edit.index)}`;
  }

  return output;
}

export default consoleLocationLoader;
