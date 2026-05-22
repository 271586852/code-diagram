import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { GithubData } from "~/server/generate/github";

const MAX_FILE_TREE_CHARACTERS = 180_000;
const MAX_CONTEXT_CHARACTERS = 160_000;
const MAX_FILE_EXCERPT_CHARACTERS = 12_000;
const MAX_CONTEXT_FILES = 80;

const EXCLUDED_PATH_SEGMENTS = new Set([
  ".cache",
  ".git",
  ".idea",
  ".next",
  ".turbo",
  ".venv",
  ".vscode",
  "__pycache__",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
  "venv",
]);

const EXCLUDED_FILE_NAMES = new Set([
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

const TEXT_FILE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".graphql",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".md",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".vue",
  ".yaml",
  ".yml",
]);

const PRIORITY_FILE_NAMES = new Set([
  "README.md",
  "README",
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "docker-compose.yml",
  "Dockerfile",
]);

export interface LocalRepoIdentity {
  username: string;
  repo: string;
  displayName: string;
}

export function getAllowedLocalRoot(): string {
  return path.resolve(process.env.LOCAL_REPO_ROOT?.trim() || process.cwd());
}

function expandHome(input: string): string {
  if (input === "~" || input.startsWith("~/")) {
    return path.join(process.env.HOME || "", input.slice(2));
  }

  return input;
}

export function resolveLocalPath(input: string): string {
  const expanded = expandHome(input.trim());
  return path.resolve(expanded);
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function resolveAllowedLocalDirectory(localPath: string): Promise<string> {
  const allowedRoot = getAllowedLocalRoot();
  const rootPath = resolveLocalPath(localPath);

  if (!isInside(allowedRoot, rootPath)) {
    throw new Error(
      `Local folder is outside LOCAL_REPO_ROOT (${allowedRoot}). Set LOCAL_REPO_ROOT to allow this path.`,
    );
  }

  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error("Local path must point to a directory.");
  }

  return rootPath;
}

function shouldSkip(relativePath: string): boolean {
  const normalized = relativePath.split(path.sep).join("/");
  const segments = normalized.split("/");
  const fileName = segments.at(-1) ?? "";
  const lower = normalized.toLowerCase();

  if (segments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) {
    return true;
  }

  if (EXCLUDED_FILE_NAMES.has(fileName)) {
    return true;
  }

  return (
    lower.endsWith(".log") ||
    lower.endsWith(".map") ||
    lower.endsWith(".min.js") ||
    lower.endsWith(".min.css") ||
    lower.match(/\.(png|jpg|jpeg|gif|webp|ico|svg|pdf|zip|tar|gz|woff2?|ttf)$/u) !==
      null
  );
}

function isTextFile(relativePath: string): boolean {
  const fileName = path.basename(relativePath);
  return (
    PRIORITY_FILE_NAMES.has(fileName) ||
    TEXT_FILE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())
  );
}

function contextPriority(relativePath: string): number {
  const fileName = path.basename(relativePath);
  if (PRIORITY_FILE_NAMES.has(fileName)) return 0;
  if (relativePath.includes("/src/") || relativePath.startsWith("src/")) return 1;
  if (relativePath.includes("/app/") || relativePath.startsWith("app/")) return 2;
  return 3;
}

async function walkDirectory(root: string): Promise<string[]> {
  const paths: string[] = [];

  async function walk(current: string) {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      if (!relative || shouldSkip(relative)) continue;

      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }

      if (entry.isFile()) {
        paths.push(relative.split(path.sep).join("/"));
      }
    }
  }

  await walk(root);
  return paths;
}

async function readLocalContext(root: string, filePaths: string[]): Promise<string> {
  let context = "";
  let included = 0;
  const candidates = filePaths
    .filter(isTextFile)
    .sort((a, b) => contextPriority(a) - contextPriority(b) || a.localeCompare(b));

  for (const relativePath of candidates) {
    if (included >= MAX_CONTEXT_FILES || context.length >= MAX_CONTEXT_CHARACTERS) {
      break;
    }

    const absolute = path.join(root, relativePath);
    let content: string;
    try {
      const fileStat = await stat(absolute);
      if (fileStat.size > MAX_FILE_EXCERPT_CHARACTERS * 4) {
        continue;
      }

      content = await readFile(absolute, "utf8");
      if (content.includes("\0")) {
        continue;
      }
    } catch {
      continue;
    }

    if (content.length > MAX_FILE_EXCERPT_CHARACTERS) {
      content = `${content.slice(0, MAX_FILE_EXCERPT_CHARACTERS)}\n...[truncated]`;
    }

    const nextBlock = `\n\n<file path="${relativePath}">\n${content}\n</file>`;
    if (context.length + nextBlock.length > MAX_CONTEXT_CHARACTERS) {
      break;
    }

    context += nextBlock;
    included += 1;
  }

  return context.trim() || "No readable text files were selected for context.";
}

export function getLocalRepoIdentity(localPath: string): LocalRepoIdentity {
  const absolutePath = resolveLocalPath(localPath);
  const baseName = path.basename(absolutePath) || "local-folder";
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48) || "local-folder";
  const hash = createHash("sha256").update(absolutePath).digest("hex").slice(0, 10);

  return {
    username: "local",
    repo: `${slug}-${hash}`,
    displayName: absolutePath,
  };
}

export async function getLocalFolderData(
  localPath: string,
): Promise<GithubData & { rootPath: string }> {
  const rootPath = await resolveAllowedLocalDirectory(localPath);

  const filePaths = await walkDirectory(rootPath);
  if (!filePaths.length) {
    throw new Error("Local folder did not contain any readable files.");
  }

  const fileTree = filePaths.join("\n");
  if (fileTree.length > MAX_FILE_TREE_CHARACTERS) {
    throw new Error(
      "Local folder file tree is too large. Use a smaller folder or add exclusions.",
    );
  }

  const readme = await readLocalContext(rootPath, filePaths);

  return {
    defaultBranch: "local",
    fileTree,
    readme,
    isPrivate: true,
    stargazerCount: null,
    rootPath,
  };
}
