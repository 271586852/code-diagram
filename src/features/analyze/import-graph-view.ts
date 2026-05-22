import type {
  ImportGraphEdge,
  ImportGraphResult,
} from "~/features/analyze/import-graph-types";

export type ImportGraphViewMode = "file" | "folder" | "folder2";
export type ImportGraphRelationScope = "matched" | "one" | "all";
export type ImportGraphRelationDirection = "both" | "out" | "in";

export type ImportGraphLayoutName =
  | "cose"
  | "concentric"
  | "breadthfirst"
  | "circle"
  | "grid";

export interface ImportGraphElementsOptions {
  graph: ImportGraphResult;
  mode: ImportGraphViewMode;
  focusDir: string;
  search: string;
  relationScope: ImportGraphRelationScope;
  relationDirection: ImportGraphRelationDirection;
  hideOrphan: boolean;
  onlyDynamic: boolean;
}

export interface ImportGraphCyNodeData {
  id: string;
  label: string;
  fullPath: string;
  kind: "file" | "group";
  dir?: string;
  size?: number;
  fanIn?: number;
  fanOut?: number;
  matched?: boolean;
  external?: boolean;
  orphan?: boolean;
  dynamic?: boolean;
}

export interface ImportGraphCyEdgeData {
  id: string;
  source: string;
  target: string;
  weight?: number;
  dynamic?: boolean;
}

export interface ImportGraphElements {
  nodes: Array<{ data: ImportGraphCyNodeData }>;
  edges: Array<{ data: ImportGraphCyEdgeData }>;
  matchedIds: Set<string>;
  totalNodeCount: number;
  totalEdgeCount: number;
}

export function trimSrc(value: string): string {
  return value.startsWith("src/") ? value.slice(4) : value;
}

export function topDir(value: string): string {
  const trimmed = trimSrc(value);
  const slash = trimmed.indexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(0, slash);
}

export function topTwoDir(value: string): string {
  const trimmed = trimSrc(value);
  const parts = trimmed.split("/");
  if (parts.length <= 1) return parts[0] ?? trimmed;
  return `${parts[0]}/${parts[1]}`;
}

export function listTopDirs(graph: ImportGraphResult): string[] {
  const result = new Set<string>();
  for (const node of graph.nodes) {
    result.add(topDir(node.path));
  }
  for (const edge of graph.edges) {
    result.add(topDir(edge.from));
    result.add(topDir(edge.to));
  }
  return Array.from(result).sort();
}

function isDynamicEdge(edge: ImportGraphEdge): boolean {
  return edge.kind === "dynamic-import";
}

function edgeMatchesDirection(
  edge: ImportGraphEdge,
  id: string,
  direction: ImportGraphRelationDirection,
): boolean {
  if (direction === "out") return edge.from === id;
  if (direction === "in") return edge.to === id;
  return edge.from === id || edge.to === id;
}

function relatedIdByDirection(
  edge: ImportGraphEdge,
  id: string,
  direction: ImportGraphRelationDirection,
): string | null {
  if (direction === "out" && edge.from === id) return edge.to;
  if (direction === "in" && edge.to === id) return edge.from;
  if (direction === "both") {
    if (edge.from === id) return edge.to;
    if (edge.to === id) return edge.from;
  }
  return null;
}

function expandSearchIds(
  seedIds: Set<string>,
  edges: ImportGraphEdge[],
  scope: ImportGraphRelationScope,
  direction: ImportGraphRelationDirection,
): Set<string> {
  const expanded = new Set(seedIds);
  if (!seedIds.size || scope === "matched") return expanded;

  const recursive = scope === "all";
  const queue: string[] = Array.from(seedIds);

  while (queue.length) {
    const id = queue.shift();
    if (!id) break;

    for (const edge of edges) {
      if (!edgeMatchesDirection(edge, id, direction)) continue;
      const related = relatedIdByDirection(edge, id, direction);
      if (related && !expanded.has(related)) {
        expanded.add(related);
        if (recursive) queue.push(related);
      }
    }

    if (!recursive && queue.length === 0) break;
  }

  return expanded;
}

function buildOrphanSet(graph: ImportGraphResult): Set<string> {
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    seen.add(edge.from);
    seen.add(edge.to);
  }
  const orphan = new Set<string>();
  for (const node of graph.nodes) {
    if (!seen.has(node.path)) orphan.add(node.path);
  }
  return orphan;
}

export function buildImportGraphElements(
  options: ImportGraphElementsOptions,
): ImportGraphElements {
  const {
    graph,
    mode,
    focusDir,
    search,
    relationScope,
    relationDirection,
    hideOrphan,
    onlyDynamic,
  } = options;

  const orphanSet = buildOrphanSet(graph);
  const allEdges = onlyDynamic ? graph.edges.filter(isDynamicEdge) : graph.edges;

  if (mode === "file") {
    const keyword = search.trim().toLowerCase();
    let candidateNodes = graph.nodes;
    if (focusDir) {
      candidateNodes = candidateNodes.filter(
        (node) => topDir(node.path) === focusDir,
      );
    }
    if (hideOrphan) {
      candidateNodes = candidateNodes.filter((node) => !orphanSet.has(node.path));
    }

    let matchedIds = new Set<string>();
    let visibleNodes = candidateNodes;

    if (keyword) {
      const seeds = candidateNodes.filter((node) =>
        node.path.toLowerCase().includes(keyword),
      );
      matchedIds = new Set(seeds.map((node) => node.path));
      const expandedIds = expandSearchIds(
        matchedIds,
        allEdges,
        relationScope,
        relationDirection,
      );
      visibleNodes = graph.nodes.filter((node) => expandedIds.has(node.path));
      if (hideOrphan) {
        visibleNodes = visibleNodes.filter(
          (node) => !orphanSet.has(node.path) || matchedIds.has(node.path),
        );
      }
    }

    const visibleIds = new Set(visibleNodes.map((node) => node.path));
    let visibleEdges = allEdges.filter(
      (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
    );

    if (keyword && relationScope !== "matched") {
      visibleEdges = visibleEdges.filter((edge) => {
        for (const id of matchedIds) {
          if (edgeMatchesDirection(edge, id, relationDirection)) return true;
        }
        if (relationScope === "all") {
          return visibleIds.has(edge.from) && visibleIds.has(edge.to);
        }
        return false;
      });
    }

    const fanIn = new Map<string, number>();
    const fanOut = new Map<string, number>();
    for (const edge of visibleEdges) {
      fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
      fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
    }

    const nodes = visibleNodes.map((node) => {
      const label = node.path.split("/").pop() ?? node.path;
      return {
        data: {
          id: node.path,
          label,
          fullPath: node.path,
          kind: "file" as const,
          dir: topDir(node.path),
          fanIn: fanIn.get(node.path) ?? 0,
          fanOut: fanOut.get(node.path) ?? 0,
          matched: matchedIds.has(node.path),
          external: Boolean(keyword) && !matchedIds.has(node.path),
          orphan: orphanSet.has(node.path),
        },
      };
    });

    const seenEdgeKey = new Set<string>();
    const edgeElements: Array<{ data: ImportGraphCyEdgeData }> = [];
    visibleEdges.forEach((edge, index) => {
      const key = `${edge.from}||${edge.to}||${edge.kind}`;
      if (seenEdgeKey.has(key)) return;
      seenEdgeKey.add(key);
      edgeElements.push({
        data: {
          id: `e${index}`,
          source: edge.from,
          target: edge.to,
          dynamic: isDynamicEdge(edge),
        },
      });
    });

    return {
      nodes,
      edges: edgeElements,
      matchedIds,
      totalNodeCount: graph.nodes.length,
      totalEdgeCount: graph.edges.length,
    };
  }

  // 目录聚合（folder / folder2）
  const groupFn = mode === "folder2" ? topTwoDir : topDir;
  let candidateNodes = graph.nodes;
  if (focusDir && mode === "folder2") {
    candidateNodes = candidateNodes.filter(
      (node) => topDir(node.path) === focusDir,
    );
  }
  if (hideOrphan) {
    candidateNodes = candidateNodes.filter((node) => !orphanSet.has(node.path));
  }

  const groupSize = new Map<string, number>();
  for (const node of candidateNodes) {
    const groupId = groupFn(node.path);
    groupSize.set(groupId, (groupSize.get(groupId) ?? 0) + 1);
  }
  const groupSet = new Set(groupSize.keys());

  const edgeWeight = new Map<string, { weight: number; dynamic: boolean }>();
  for (const edge of allEdges) {
    const a = groupFn(edge.from);
    const b = groupFn(edge.to);
    if (!groupSet.has(a) || !groupSet.has(b)) continue;
    if (a === b) continue;
    const key = `${a}||${b}`;
    const entry = edgeWeight.get(key) ?? { weight: 0, dynamic: false };
    entry.weight += 1;
    if (isDynamicEdge(edge)) entry.dynamic = true;
    edgeWeight.set(key, entry);
  }

  const keyword = search.trim().toLowerCase();
  let visibleGroupIds = new Set(groupSet);
  let matchedGroups = new Set<string>();
  if (keyword) {
    matchedGroups = new Set(
      Array.from(groupSet).filter((groupId) =>
        groupId.toLowerCase().includes(keyword),
      ),
    );
    if (matchedGroups.size === 0) {
      const matchedFiles = candidateNodes.filter((node) =>
        node.path.toLowerCase().includes(keyword),
      );
      matchedGroups = new Set(matchedFiles.map((node) => groupFn(node.path)));
    }

    if (relationScope === "matched") {
      visibleGroupIds = new Set(matchedGroups);
    } else {
      const expanded = new Set(matchedGroups);
      const recursive = relationScope === "all";
      const queue = Array.from(matchedGroups);
      while (queue.length) {
        const id = queue.shift();
        if (!id) break;
        for (const [key, entry] of edgeWeight.entries()) {
          const [a, b] = key.split("||");
          if (!a || !b) continue;
          const matchOut = relationDirection !== "in" && a === id;
          const matchIn = relationDirection !== "out" && b === id;
          if (!matchOut && !matchIn) continue;
          const related = matchOut ? b : a;
          if (!expanded.has(related)) {
            expanded.add(related);
            if (recursive) queue.push(related);
          }
          // entry referenced to satisfy linter
          void entry;
        }
        if (!recursive && queue.length === 0) break;
      }
      visibleGroupIds = expanded;
    }
  }

  const nodes = Array.from(visibleGroupIds).map((groupId) => ({
    data: {
      id: groupId,
      label: `${groupId}\n(${groupSize.get(groupId) ?? 0})`,
      fullPath: `src/${groupId}`,
      kind: "group" as const,
      size: groupSize.get(groupId) ?? 0,
      matched: matchedGroups.has(groupId),
      external: Boolean(keyword) && !matchedGroups.has(groupId),
    },
  }));

  let index = 0;
  const edgeElements: Array<{ data: ImportGraphCyEdgeData }> = [];
  for (const [key, entry] of edgeWeight.entries()) {
    const [a, b] = key.split("||");
    if (!a || !b) continue;
    if (!visibleGroupIds.has(a) || !visibleGroupIds.has(b)) continue;
    edgeElements.push({
      data: {
        id: `g${index++}`,
        source: a,
        target: b,
        weight: entry.weight,
        dynamic: entry.dynamic,
      },
    });
  }

  return {
    nodes,
    edges: edgeElements,
    matchedIds: matchedGroups,
    totalNodeCount: graph.nodes.length,
    totalEdgeCount: graph.edges.length,
  };
}
