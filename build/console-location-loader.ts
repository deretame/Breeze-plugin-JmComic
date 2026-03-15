import ts from "typescript";

const METHODS = new Set([
  "log",
  "info",
  "warn",
  "error",
  "debug",
  "table",
  "dir",
]);

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

function consoleLocationLoader(this: { resourcePath: string }, source: string): string {
  const filePath = toPosixPath(this.resourcePath);

  if (!filePath.includes("/src/")) {
    return source;
  }

  const sourceFile = ts.createSourceFile(
    this.resourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    this.resourcePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const edits: Array<{ index: number; text: string }> = [];

  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === "console"
    ) {
      const method = node.expression.name.text;
      if (METHODS.has(method)) {
        const lineInfo = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        const line = lineInfo.line + 1;
        const column = lineInfo.character + 1;
        const location = `${filePath}:${line}:${column}`;

        const openParen = findOpenParen(
          source,
          node.expression.end,
          node.end,
        );

        if (openParen >= 0) {
          const insert =
            node.arguments.length > 0
              ? `${JSON.stringify(location)}, `
              : JSON.stringify(location);
          edits.push({ index: openParen + 1, text: insert });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

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
