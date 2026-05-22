import { pathToFileURL } from "node:url";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type {
  ImportEdgeKind,
  ImportGraphEdge,
  ImportGraphNode,
  ImportGraphResult,
} from "~/features/analyze/import-graph-types";
import { resolveAllowedLocalDirectory } from "~/server/generate/local";

const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs",
] as const;

const EXCLUDED_SEGMENTS = new Set([
  ".cache",
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const DEFAULT_MAX_NODES = 180;
const DEFAULT_MAX_EDGES = 320;

export function formatImportGraphSummary(graph: ImportGraphResult): string {
  const lines = [
    `source_files: ${graph.totalSourceFiles}`,
    `resolved_import_edges: ${graph.totalResolvedEdges}`,
    `rendered_edges: ${graph.edges.length}`,
    graph.truncated ? "note: graph was capped for readability" : "",
    "",
    ...graph.edges.map(
      (edge) => `${edge.from} -> ${edge.to} (${edge.kind}: ${edge.specifier})`,
    ),
  ].filter(Boolean);

  return lines.join("\n");
}

interface TsConfigInfo {
  baseUrl: string;
  paths: Array<{
    prefix: string;
    suffix: string;
    targets: string[];
  }>;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function shouldSkip(relativePath: string): boolean {
  return relativePath
    .split(path.sep)
    .some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.includes(
    path.extname(filePath) as (typeof SOURCE_EXTENSIONS)[number],
  );
}

async function walkSourceFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentPath: string) {
    let entries: Dirent[];
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relativePath = path.relative(rootPath, absolutePath);
      if (!relativePath || shouldSkip(relativePath)) continue;

      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }

      if (entry.isFile() && isSourceFile(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }

  await walk(rootPath);
  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch {
    return false;
  }
}

async function resolveAsFileOrDirectory(candidatePath: string): Promise<string | null> {
  if (await fileExists(candidatePath)) {
    return candidatePath;
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const withExtension = `${candidatePath}${extension}`;
    if (await fileExists(withExtension)) {
      return withExtension;
    }
  }

  for (const extension of SOURCE_EXTENSIONS) {
    const indexPath = path.join(candidatePath, `index${extension}`);
    if (await fileExists(indexPath)) {
      return indexPath;
    }
  }

  return null;
}

async function findTsConfig(startPath: string): Promise<string | null> {
  let currentPath = startPath;
  while (true) {
    const candidate = path.join(currentPath, "tsconfig.json");
    if (await fileExists(candidate)) {
      return candidate;
    }

    const parent = path.dirname(currentPath);
    if (parent === currentPath) {
      return null;
    }
    currentPath = parent;
  }
}

async function readTsConfig(rootPath: string): Promise<TsConfigInfo> {
  const tsConfigPath = await findTsConfig(rootPath);
  if (!tsConfigPath) {
    return { baseUrl: rootPath, paths: [] };
  }

  try {
    const raw = await readFile(tsConfigPath, "utf8");
    const parsedConfig = ts.parseConfigFileTextToJson(tsConfigPath, raw);
    if (!parsedConfig.config) {
      return { baseUrl: rootPath, paths: [] };
    }
    const parsed = parsedConfig.config as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };
    const compilerOptions = parsed.compilerOptions ?? {};
    const configDir = path.dirname(tsConfigPath);
    const baseUrl = path.resolve(configDir, compilerOptions.baseUrl ?? ".");
    const paths = Object.entries(compilerOptions.paths ?? {}).map(
      ([alias, targets]) => {
        const wildcardIndex = alias.indexOf("*");
        return {
          prefix: wildcardIndex >= 0 ? alias.slice(0, wildcardIndex) : alias,
          suffix: wildcardIndex >= 0 ? alias.slice(wildcardIndex + 1) : "",
          targets,
        };
      },
    );

    return { baseUrl, paths };
  } catch {
    return { baseUrl: rootPath, paths: [] };
  }
}

async function resolveAliasImport(
  specifier: string,
  config: TsConfigInfo,
): Promise<string | null> {
  for (const alias of config.paths) {
    if (!specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) {
      continue;
    }

    const matched = specifier.slice(
      alias.prefix.length,
      specifier.length - alias.suffix.length,
    );
    for (const target of alias.targets) {
      const replaced = target.replace("*", matched);
      const resolved = await resolveAsFileOrDirectory(
        path.resolve(config.baseUrl, replaced),
      );
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

function isPotentialInternalSpecifier(
  specifier: string,
  config: TsConfigInfo,
): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    config.paths.some(
      (alias) =>
        specifier.startsWith(alias.prefix) && specifier.endsWith(alias.suffix),
    )
  );
}

async function resolveImportSpecifier(params: {
  importerPath: string;
  rootPath: string;
  specifier: string;
  config: TsConfigInfo;
}): Promise<string | null> {
  const { importerPath, rootPath, specifier, config } = params;

  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const basePath = specifier.startsWith("/")
      ? path.join(rootPath, specifier)
      : path.resolve(path.dirname(importerPath), specifier);
    return resolveAsFileOrDirectory(basePath);
  }

  return resolveAliasImport(specifier, config);
}

function getStringLiteralText(node: ts.Node): string | null {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : null;
}

function collectImportSpecifiers(sourceFile: ts.SourceFile): Array<{
  specifier: string;
  kind: ImportEdgeKind;
}> {
  const imports: Array<{ specifier: string; kind: ImportEdgeKind }> = [];

  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node)) {
      const specifier = getStringLiteralText(node.moduleSpecifier);
      if (specifier) imports.push({ specifier, kind: "static-import" });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = getStringLiteralText(node.moduleSpecifier);
      if (specifier) imports.push({ specifier, kind: "export" });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const specifier = node.arguments[0]
        ? getStringLiteralText(node.arguments[0])
        : null;
      if (specifier) imports.push({ specifier, kind: "dynamic-import" });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      const specifier = node.arguments[0]
        ? getStringLiteralText(node.arguments[0])
        : null;
      if (specifier) imports.push({ specifier, kind: "require" });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return imports;
}

function mermaidNodeId(filePath: string): string {
  return `file_${filePath.replace(/[^a-zA-Z0-9_]/gu, "_")}`;
}

function escapeMermaidText(value: string): string {
  return value.replace(/\\/gu, "\\\\").replace(/"/gu, '\\"');
}

function labelForPath(filePath: string): string {
  const directory = path.posix.dirname(filePath);
  const fileName = path.posix.basename(filePath);
  return directory === "."
    ? fileName
    : `${fileName}<br/>${directory.length > 44 ? `...${directory.slice(-41)}` : directory}`;
}

function compileMermaidImportGraph(params: {
  rootPath: string;
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];
  truncated: boolean;
}): string {
  const lines = ["flowchart LR"];

  if (params.truncated) {
    lines.push(
      'truncated["Graph truncated for readability. Use a smaller folder for more detail."]',
    );
    lines.push("class truncated meta");
  }

  for (const node of params.nodes) {
    lines.push(
      `${mermaidNodeId(node.id)}["${escapeMermaidText(labelForPath(node.path))}"]`,
    );
  }

  for (const edge of params.edges) {
    const connector = edge.kind === "dynamic-import" ? "-.->" : "-->";
    lines.push(`${mermaidNodeId(edge.from)} ${connector} ${mermaidNodeId(edge.to)}`);
  }

  for (const node of params.nodes) {
    lines.push(
      `click ${mermaidNodeId(node.id)} "${pathToFileURL(
        path.join(params.rootPath, node.path),
      ).toString()}"`,
    );
  }

  lines.push("");
  lines.push("classDef meta fill:#fef3c7,stroke:#d97706,color:#78350f");

  return lines.join("\n");
}

export async function buildImportDependencyGraph(params: {
  localPath: string;
  maxNodes?: number;
  maxEdges?: number;
}): Promise<ImportGraphResult> {
  const rootPath = await resolveAllowedLocalDirectory(params.localPath);
  const maxNodes = params.maxNodes ?? DEFAULT_MAX_NODES;
  const maxEdges = params.maxEdges ?? DEFAULT_MAX_EDGES;
  const config = await readTsConfig(rootPath);
  const sourceFiles = await walkSourceFiles(rootPath);
  const edges: ImportGraphEdge[] = [];
  let totalUnresolvedImports = 0;

  for (const sourceFilePath of sourceFiles) {
    const content = await readFile(sourceFilePath, "utf8");
    const sourceFile = ts.createSourceFile(
      sourceFilePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      sourceFilePath.endsWith(".tsx") || sourceFilePath.endsWith(".jsx")
        ? ts.ScriptKind.TSX
        : ts.ScriptKind.TS,
    );
    const from = toPosixPath(path.relative(rootPath, sourceFilePath));

    for (const imported of collectImportSpecifiers(sourceFile)) {
      const resolved = await resolveImportSpecifier({
        importerPath: sourceFilePath,
        rootPath,
        specifier: imported.specifier,
        config,
      });
      if (!resolved) {
        if (isPotentialInternalSpecifier(imported.specifier, config)) {
          totalUnresolvedImports += 1;
        }
        continue;
      }

      const to = toPosixPath(path.relative(rootPath, resolved));
      if (to && to !== from) {
        edges.push({
          from,
          to,
          specifier: imported.specifier,
          kind: imported.kind,
        });
      }
    }
  }

  const importCounts = new Map<string, number>();
  const importedByCounts = new Map<string, number>();
  for (const edge of edges) {
    importCounts.set(edge.from, (importCounts.get(edge.from) ?? 0) + 1);
    importedByCounts.set(edge.to, (importedByCounts.get(edge.to) ?? 0) + 1);
  }

  const rankedFiles = new Set(
    Array.from(new Set(edges.flatMap((edge) => [edge.from, edge.to])))
      .sort((a, b) => {
        const scoreA = (importCounts.get(a) ?? 0) + (importedByCounts.get(a) ?? 0);
        const scoreB = (importCounts.get(b) ?? 0) + (importedByCounts.get(b) ?? 0);
        return scoreB - scoreA || a.localeCompare(b);
      })
      .slice(0, maxNodes),
  );
  const visibleEdges = edges
    .filter((edge) => rankedFiles.has(edge.from) && rankedFiles.has(edge.to))
    .slice(0, maxEdges);
  const visibleNodeIds = new Set(visibleEdges.flatMap((edge) => [edge.from, edge.to]));
  const nodes = Array.from(visibleNodeIds)
    .sort((a, b) => a.localeCompare(b))
    .map<ImportGraphNode>((filePath) => ({
      id: filePath,
      path: filePath,
      importCount: importCounts.get(filePath) ?? 0,
      importedByCount: importedByCounts.get(filePath) ?? 0,
    }));
  const truncated = nodes.length < rankedFiles.size || visibleEdges.length < edges.length;

  return {
    nodes,
    edges: visibleEdges,
    mermaid: compileMermaidImportGraph({
      rootPath,
      nodes,
      edges: visibleEdges,
      truncated,
    }),
    truncated,
    totalSourceFiles: sourceFiles.length,
    totalResolvedEdges: edges.length,
    totalUnresolvedImports,
  };
}
