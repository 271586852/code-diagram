import type {
  ImportGraphEdge,
  ImportGraphExternalEdge,
  ImportGraphNode,
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
  onlyCircular: boolean;
  selectedFileId?: string | null;
}

export interface ImportGraphCyNodeData {
  id: string;
  label: string;
  fullPath: string;
  kind: "file" | "group";
  dir?: string;
  size?: number;
  orphanCount?: number;
  circularCount?: number;
  fanIn?: number;
  fanOut?: number;
  matched?: boolean;
  external?: boolean;
  orphan?: boolean;
  circular?: boolean;
  dynamic?: boolean;
}

export interface ImportGraphCyEdgeData {
  id: string;
  source: string;
  target: string;
  weight?: number;
  dynamic?: boolean;
  circular?: boolean;
  external?: boolean;
}

export interface ImportGraphElements {
  nodes: Array<{ data: ImportGraphCyNodeData }>;
  edges: Array<{ data: ImportGraphCyEdgeData }>;
  matchedIds: Set<string>;
  totalNodeCount: number;
  totalEdgeCount: number;
}

interface NormalizedImportGraph {
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];
  externalEdges: ImportGraphExternalEdge[];
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

function externalNodeId(edge: ImportGraphExternalEdge): string {
  return `external:${edge.absolutePath}`;
}

function externalNodeLabel(edge: ImportGraphExternalEdge): string {
  const cleaned = edge.to.replace(/^\.\.\//u, "../");
  const parts = cleaned.split("/");
  return parts[parts.length - 1] || cleaned || edge.specifier;
}

function normalizeGraph(graph: ImportGraphResult): NormalizedImportGraph {
  if (!graph.modules?.length) {
    return {
      nodes: graph.nodes,
      edges: graph.edges,
      externalEdges: graph.externalEdges ?? [],
    };
  }

  const edgeList: ImportGraphEdge[] = [];
  const importCounts = new Map<string, number>();
  const importedByCounts = new Map<string, number>();
  const nodeMeta = new Map<
    string,
    Pick<ImportGraphNode, "orphan" | "circular">
  >();

  for (const mod of graph.modules) {
    nodeMeta.set(mod.source, {
      orphan: mod.orphan,
      circular: mod.circular,
    });
    for (const dep of mod.deps) {
      edgeList.push({
        from: mod.source,
        to: dep.to,
        specifier: dep.specifier,
        kind: dep.kind,
        dynamic: dep.dynamic,
        circular: dep.circular,
      });
      importCounts.set(mod.source, (importCounts.get(mod.source) ?? 0) + 1);
      importedByCounts.set(dep.to, (importedByCounts.get(dep.to) ?? 0) + 1);
    }
  }

  const nodes = graph.modules.map<ImportGraphNode>((mod) => ({
    id: mod.source,
    path: mod.source,
    importCount: importCounts.get(mod.source) ?? 0,
    importedByCount: importedByCounts.get(mod.source) ?? 0,
    orphan: nodeMeta.get(mod.source)?.orphan ?? false,
    circular: nodeMeta.get(mod.source)?.circular ?? false,
  }));

  return {
    nodes,
    edges: edgeList,
    externalEdges: graph.externalEdges ?? [],
  };
}

export function listTopDirs(graph: ImportGraphResult): string[] {
  const normalized = normalizeGraph(graph);
  const result = new Set<string>();
  for (const node of normalized.nodes) {
    result.add(topDir(node.path));
  }
  return Array.from(result).sort();
}

function isDynamicEdge(edge: ImportGraphEdge): boolean {
  return edge.dynamic || edge.kind === "dynamic-import";
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

function filterEdges(
  edges: ImportGraphEdge[],
  options: Pick<ImportGraphElementsOptions, "onlyDynamic" | "onlyCircular">,
): ImportGraphEdge[] {
  return edges.filter((edge) => {
    if (options.onlyDynamic && !isDynamicEdge(edge)) return false;
    if (options.onlyCircular && !edge.circular) return false;
    return true;
  });
}

function shrinkNodesToEdges(
  nodes: ImportGraphNode[],
  edges: ImportGraphEdge[],
): ImportGraphNode[] {
  const involved = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
  return nodes.filter((node) => involved.has(node.path));
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
    onlyCircular,
    selectedFileId,
  } = options;

  const normalized = normalizeGraph(graph);
  const allEdges = filterEdges(normalized.edges, { onlyDynamic, onlyCircular });
  const allNodes = normalized.nodes;
  const allExternalEdges = normalized.externalEdges.filter((edge) => {
    if (onlyDynamic && !edge.dynamic) return false;
    if (onlyCircular) return false;
    return true;
  });

  if (mode === "file") {
    const keyword = search.trim().toLowerCase();
    let candidateNodes = allNodes;
    if (focusDir) {
      candidateNodes = candidateNodes.filter(
        (node) => topDir(node.path) === focusDir,
      );
    }
    if (hideOrphan) {
      candidateNodes = candidateNodes.filter((node) => !node.orphan);
    }
    if (onlyCircular && !keyword) {
      candidateNodes = candidateNodes.filter((node) => node.circular);
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
      visibleNodes = allNodes.filter((node) => expandedIds.has(node.path));
      if (hideOrphan) {
        visibleNodes = visibleNodes.filter(
          (node) => !node.orphan || matchedIds.has(node.path),
        );
      }
    }

    let visibleIds = new Set(visibleNodes.map((node) => node.path));
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

    if (onlyCircular) {
      visibleNodes = shrinkNodesToEdges(visibleNodes, visibleEdges);
      visibleIds = new Set(visibleNodes.map((node) => node.path));
      visibleEdges = visibleEdges.filter(
        (edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to),
      );
    }

    const selectedExternalEdges =
      selectedFileId && visibleIds.has(selectedFileId)
        ? allExternalEdges.filter((edge) => edge.from === selectedFileId)
        : [];

    const externalNodes = Array.from(
      new Map(
        selectedExternalEdges.map((edge) => [externalNodeId(edge), edge]),
      ).values(),
    );

    const fanIn = new Map<string, number>();
    const fanOut = new Map<string, number>();
    for (const edge of visibleEdges) {
      fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
      fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
    }
    for (const edge of selectedExternalEdges) {
      const targetId = externalNodeId(edge);
      fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
      fanIn.set(targetId, (fanIn.get(targetId) ?? 0) + 1);
    }

    const nodes = [
      ...visibleNodes.map((node) => {
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
            orphan: node.orphan,
            circular: node.circular,
          },
        };
      }),
      ...externalNodes.map((edge) => ({
        data: {
          id: externalNodeId(edge),
          label: externalNodeLabel(edge),
          fullPath: edge.to,
          kind: "file" as const,
          dir: edge.to.includes("/") ? edge.to.slice(0, edge.to.lastIndexOf("/")) : "",
          fanIn: fanIn.get(externalNodeId(edge)) ?? 0,
          fanOut: 0,
          matched: false,
          external: true,
          orphan: false,
          circular: false,
        },
      })),
    ];

    const seenEdgeKey = new Set<string>();
    const edgeElements: Array<{ data: ImportGraphCyEdgeData }> = [];
    visibleEdges.forEach((edge, index) => {
      const key = `${edge.from}||${edge.to}||${edge.kind}||${edge.specifier}`;
      if (seenEdgeKey.has(key)) return;
      seenEdgeKey.add(key);
      edgeElements.push({
        data: {
          id: `e${index}`,
          source: edge.from,
          target: edge.to,
          dynamic: isDynamicEdge(edge),
          circular: edge.circular,
          external: false,
        },
      });
    });
    selectedExternalEdges.forEach((edge, index) => {
      const key = `${edge.from}||${externalNodeId(edge)}||${edge.kind}||${edge.specifier}`;
      if (seenEdgeKey.has(key)) return;
      seenEdgeKey.add(key);
      edgeElements.push({
        data: {
          id: `x${index}`,
          source: edge.from,
          target: externalNodeId(edge),
          dynamic: edge.dynamic,
          circular: false,
          external: true,
        },
      });
    });

    return {
      nodes,
      edges: edgeElements,
      matchedIds,
      totalNodeCount: allNodes.length,
      totalEdgeCount: normalized.edges.length + normalized.externalEdges.length,
    };
  }

  // 目录聚合（folder / folder2）
  const groupFn = mode === "folder2" ? topTwoDir : topDir;
  let candidateNodes = allNodes;
  if (focusDir && mode === "folder2") {
    candidateNodes = candidateNodes.filter(
      (node) => topDir(node.path) === focusDir,
    );
  }
  if (hideOrphan) {
    candidateNodes = candidateNodes.filter((node) => !node.orphan);
  }

  const groupSize = new Map<string, number>();
  const groupOrphanCount = new Map<string, number>();
  const groupCircularCount = new Map<string, number>();
  for (const node of candidateNodes) {
    const groupId = groupFn(node.path);
    groupSize.set(groupId, (groupSize.get(groupId) ?? 0) + 1);
    if (node.orphan) {
      groupOrphanCount.set(groupId, (groupOrphanCount.get(groupId) ?? 0) + 1);
    }
    if (node.circular) {
      groupCircularCount.set(
        groupId,
        (groupCircularCount.get(groupId) ?? 0) + 1,
      );
    }
  }
  const groupSet = new Set(groupSize.keys());

  const edgeWeight = new Map<
    string,
    { weight: number; dynamic: boolean; circular: boolean }
  >();
  for (const edge of allEdges) {
    const a = groupFn(edge.from);
    const b = groupFn(edge.to);
    if (!groupSet.has(a) || !groupSet.has(b)) continue;
    if (a === b) continue;
    const key = `${a}||${b}`;
    const entry = edgeWeight.get(key) ?? {
      weight: 0,
      dynamic: false,
      circular: false,
    };
    entry.weight += 1;
    if (isDynamicEdge(edge)) entry.dynamic = true;
    if (edge.circular) entry.circular = true;
    edgeWeight.set(key, entry);
  }

  if (onlyCircular) {
    const involved = new Set<string>();
    for (const key of edgeWeight.keys()) {
      const [a, b] = key.split("||");
      if (a) involved.add(a);
      if (b) involved.add(b);
    }
    for (const groupId of Array.from(groupSet)) {
      if (!involved.has(groupId)) groupSet.delete(groupId);
    }
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
        for (const key of edgeWeight.keys()) {
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
      orphanCount: groupOrphanCount.get(groupId) ?? 0,
      circularCount: groupCircularCount.get(groupId) ?? 0,
      circular: (groupCircularCount.get(groupId) ?? 0) > 0,
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
        circular: entry.circular,
      },
    });
  }

  return {
    nodes,
    edges: edgeElements,
    matchedIds: matchedGroups,
    totalNodeCount: allNodes.length,
    totalEdgeCount: normalized.edges.length,
  };
}
