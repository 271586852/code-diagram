"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import cytoscape, {
  type Core,
  type ElementDefinition,
  type EventObject,
  type LayoutOptions,
  type NodeSingular,
  type StylesheetCSS,
} from "cytoscape";
import { useTheme } from "next-themes";

import type { ImportGraphResult } from "~/features/analyze/import-graph-types";
import {
  buildImportGraphElements,
  listTopDirs,
  type ImportGraphLayoutName,
  type ImportGraphRelationDirection,
  type ImportGraphRelationScope,
  type ImportGraphViewMode,
} from "~/features/analyze/import-graph-view";

interface ImportGraphCytoscapeProps {
  graph: ImportGraphResult;
}

interface NodeDetail {
  id: string;
  fullPath: string;
  kind: "file" | "group";
  dir?: string;
  size?: number;
  fanIn?: number;
  fanOut?: number;
  matched?: boolean;
  external?: boolean;
  orphan?: boolean;
  outgoing: string[];
  incoming: string[];
}

const DARK_PALETTE = {
  bgPanel: "#1a1f29",
  bgElev: "#232a36",
  border: "#2c3442",
  text: "#e6edf3",
  textDim: "#8b949e",
  accent: "#4493f8",
  node: "#4493f8",
  group: "#3fb950",
  matched: "#d2a8ff",
  external: "#6e7681",
  orphan: "#f0883e",
  edge: "#5a6473",
  dynamic: "#f0883e",
  highlight: "#4493f8",
};

const LIGHT_PALETTE = {
  bgPanel: "#f5f5f4",
  bgElev: "#ffffff",
  border: "#d6d3d1",
  text: "#1c1917",
  textDim: "#57534e",
  accent: "#2563eb",
  node: "#2563eb",
  group: "#16a34a",
  matched: "#9333ea",
  external: "#94a3b8",
  orphan: "#ea580c",
  edge: "#94a3b8",
  dynamic: "#ea580c",
  highlight: "#2563eb",
};

function buildStylesheet(palette: typeof DARK_PALETTE): StylesheetCSS[] {
  return [
    {
      selector: "node",
      css: {
        "background-color": palette.node,
        label: "data(label)",
        color: palette.text,
        "font-size": 11,
        "text-wrap": "wrap",
        "text-valign": "center",
        "text-halign": "center",
        "text-outline-color": palette.bgPanel,
        "text-outline-width": 2,
        "border-width": 1,
        "border-color": palette.border,
        width: 22,
        height: 22,
      },
    },
    {
      selector: 'node[kind = "group"]',
      css: {
        "background-color": palette.group,
        shape: "round-rectangle",
        width: "mapData(size, 1, 300, 40, 120)",
        height: "mapData(size, 1, 300, 40, 120)",
        "font-size": 12,
        "font-weight": "bold",
      },
    },
    {
      selector: "node[?orphan]",
      css: { "background-color": palette.orphan },
    },
    {
      selector: "node[?external]",
      css: { "background-color": palette.external },
    },
    {
      selector: "node[?matched]",
      css: {
        "background-color": palette.matched,
        "border-color": palette.text,
        "border-width": 2,
      },
    },
    {
      selector: "node:selected",
      css: {
        "border-color": palette.accent,
        "border-width": 3,
      },
    },
    {
      selector: "edge",
      css: {
        width: 1,
        "line-color": palette.edge,
        opacity: 0.5,
        "curve-style": "bezier",
        "target-arrow-shape": "triangle",
        "target-arrow-color": palette.edge,
        "arrow-scale": 0.8,
      },
    },
    {
      selector: "edge[weight]",
      css: {
        width: "mapData(weight, 1, 200, 1, 6)",
        opacity: 0.6,
      },
    },
    {
      selector: "edge[?dynamic]",
      css: {
        "line-style": "dashed",
        "line-color": palette.dynamic,
        "target-arrow-color": palette.dynamic,
      },
    },
    {
      selector: ".faded",
      css: { opacity: 0.08, "text-opacity": 0.1 },
    },
    {
      selector: ".highlight",
      css: { opacity: 1, "text-opacity": 1 },
    },
    {
      selector: "edge.highlight",
      css: {
        "line-color": palette.highlight,
        "target-arrow-color": palette.highlight,
        width: 2,
        opacity: 1,
      },
    },
  ];
}

function getLayoutOptions(name: ImportGraphLayoutName): LayoutOptions {
  switch (name) {
    case "concentric":
      return {
        name: "concentric",
        animate: false,
        minNodeSpacing: 20,
        concentric: (n: NodeSingular) => n.degree(true),
        levelWidth: () => 3,
      } as unknown as LayoutOptions;
    case "breadthfirst":
      return {
        name: "breadthfirst",
        animate: false,
        directed: true,
        padding: 20,
        spacingFactor: 1.2,
      };
    case "circle":
      return { name: "circle", animate: false };
    case "grid":
      return { name: "grid", animate: false };
    case "cose":
    default:
      return {
        name: "cose",
        animate: false,
        idealEdgeLength: () => 80,
        nodeRepulsion: () => 8000,
        gravity: 0.3,
        numIter: 1500,
        fit: true,
      } as unknown as LayoutOptions;
  }
}

function controlBaseClass() {
  return "rounded border border-[hsl(var(--neo-border,0_0%_85%))] bg-white px-2 py-1 text-xs text-black dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100";
}

export function ImportGraphCytoscape({ graph }: ImportGraphCytoscapeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const palette = isDark ? DARK_PALETTE : LIGHT_PALETTE;

  const [mode, setMode] = useState<ImportGraphViewMode>("folder");
  const [focusDir, setFocusDir] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [relationScope, setRelationScope] =
    useState<ImportGraphRelationScope>("one");
  const [relationDirection, setRelationDirection] =
    useState<ImportGraphRelationDirection>("both");
  const [layout, setLayout] = useState<ImportGraphLayoutName>("cose");
  const [hideOrphan, setHideOrphan] = useState(false);
  const [onlyDynamic, setOnlyDynamic] = useState(false);

  const [detail, setDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const dirs = useMemo(() => listTopDirs(graph), [graph]);

  const elements = useMemo(
    () =>
      buildImportGraphElements({
        graph,
        mode,
        focusDir,
        search: debouncedSearch,
        relationScope,
        relationDirection,
        hideOrphan,
        onlyDynamic,
      }),
    [
      graph,
      mode,
      focusDir,
      debouncedSearch,
      relationScope,
      relationDirection,
      hideOrphan,
      onlyDynamic,
    ],
  );

  // 初始化 Cytoscape 实例
  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: buildStylesheet(palette),
      minZoom: 0.05,
      maxZoom: 4,
      wheelSensitivity: 0.2,
    });

    cy.on("tap", (event: EventObject) => {
      if (event.target === cy) {
        cy.elements().removeClass("faded").removeClass("highlight");
        setDetail(null);
      }
    });

    cy.on("tap", "node", (event: EventObject) => {
      const node = event.target as NodeSingular;
      const data = node.data() as {
        id: string;
        fullPath?: string;
        kind: "file" | "group";
        dir?: string;
        size?: number;
        fanIn?: number;
        fanOut?: number;
        matched?: boolean;
        external?: boolean;
        orphan?: boolean;
      };
      cy.elements().removeClass("highlight").addClass("faded");
      const neighborhood = node.closedNeighborhood();
      neighborhood.removeClass("faded").addClass("highlight");

      const outgoing = node
        .outgoers("node")
        .map((n) => (n.data("fullPath") as string | undefined) ?? n.id());
      const incoming = node
        .incomers("node")
        .map((n) => (n.data("fullPath") as string | undefined) ?? n.id());

      setDetail({
        id: data.id,
        fullPath: data.fullPath ?? data.id,
        kind: data.kind,
        dir: data.dir,
        size: data.size,
        fanIn: data.fanIn,
        fanOut: data.fanOut,
        matched: data.matched,
        external: data.external,
        orphan: data.orphan,
        outgoing,
        incoming,
      });
    });

    cy.on("dbltap", "node", (event: EventObject) => {
      const node = event.target as NodeSingular;
      cy.fit(node.closedNeighborhood(), 30);
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // 调色板依赖通过 style 同步，这里只关心实例创建/销毁
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主题切换：刷新 stylesheet
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(buildStylesheet(palette));
  }, [palette]);

  // 数据/视图变化：重新加载 elements
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const next: ElementDefinition[] = [
      ...elements.nodes.map((n) => ({ data: n.data })),
      ...elements.edges.map((e) => ({ data: e.data })),
    ];

    cy.batch(() => {
      cy.elements().remove();
      cy.add(next);
    });
    cy.layout(getLayoutOptions(layout)).run();
    setDetail(null);
  }, [elements, layout]);

  return (
    <div className="flex w-full max-w-6xl flex-col gap-3">
      <div className="grid gap-3 rounded-lg border border-neutral-200 bg-white/70 p-3 text-xs text-black sm:grid-cols-3 lg:grid-cols-6 dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-100">
        <label className="flex flex-col gap-1">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            View mode
          </span>
          <select
            className={controlBaseClass()}
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as ImportGraphViewMode)
            }
          >
            <option value="folder">Folder (1st level)</option>
            <option value="folder2">Folder (2nd level)</option>
            <option value="file">File</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            Focus directory
          </span>
          <select
            className={controlBaseClass()}
            value={focusDir}
            onChange={(event) => setFocusDir(event.target.value)}
          >
            <option value="">All</option>
            {dirs.map((dir) => (
              <option key={dir} value={dir}>
                {dir}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            Search
          </span>
          <input
            className={controlBaseClass()}
            placeholder="path or filename"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            Relation scope
          </span>
          <select
            className={controlBaseClass()}
            value={relationScope}
            onChange={(event) =>
              setRelationScope(event.target.value as ImportGraphRelationScope)
            }
          >
            <option value="one">Match + 1 hop</option>
            <option value="matched">Match only</option>
            <option value="all">Match + all up/down</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            Direction
          </span>
          <select
            className={controlBaseClass()}
            value={relationDirection}
            onChange={(event) =>
              setRelationDirection(
                event.target.value as ImportGraphRelationDirection,
              )
            }
          >
            <option value="both">Both</option>
            <option value="out">Outgoing</option>
            <option value="in">Incoming</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            Layout
          </span>
          <select
            className={controlBaseClass()}
            value={layout}
            onChange={(event) =>
              setLayout(event.target.value as ImportGraphLayoutName)
            }
          >
            <option value="cose">Force (cose)</option>
            <option value="concentric">Concentric</option>
            <option value="breadthfirst">Hierarchy</option>
            <option value="circle">Circle</option>
            <option value="grid">Grid</option>
          </select>
        </label>

        <label className="col-span-1 flex items-center gap-2 text-xs sm:col-span-3 lg:col-span-2">
          <input
            type="checkbox"
            checked={hideOrphan}
            onChange={(event) => setHideOrphan(event.target.checked)}
          />
          Hide orphan modules
        </label>
        <label className="col-span-1 flex items-center gap-2 text-xs sm:col-span-3 lg:col-span-2">
          <input
            type="checkbox"
            checked={onlyDynamic}
            onChange={(event) => setOnlyDynamic(event.target.checked)}
          />
          Only dynamic imports
        </label>

        <div className="col-span-1 ml-auto flex items-center gap-2 sm:col-span-3 lg:col-span-2">
          <button
            type="button"
            className={controlBaseClass()}
            onClick={() => cyRef.current?.fit(undefined, 30)}
          >
            Fit
          </button>
          <button
            type="button"
            className={controlBaseClass()}
            onClick={() => cyRef.current?.layout(getLayoutOptions(layout)).run()}
          >
            Relayout
          </button>
          <button
            type="button"
            className={controlBaseClass()}
            onClick={() => {
              const cy = cyRef.current;
              if (!cy) return;
              const png = cy.png({
                full: true,
                scale: 2,
                bg: palette.bgPanel,
              });
              const a = document.createElement("a");
              a.href = png;
              a.download = "import-graph.png";
              a.click();
            }}
          >
            Export PNG
          </button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <div
          ref={containerRef}
          className="h-[640px] w-full rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-[#0f1419]"
        />

        <aside className="rounded-lg border border-neutral-200 bg-white/70 p-3 text-xs text-black dark:border-neutral-800 dark:bg-neutral-950/40 dark:text-neutral-100">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold uppercase tracking-wide text-[hsl(var(--neo-soft-text))]">
              Details
            </span>
            <span className="text-[10px] text-[hsl(var(--neo-soft-text))]">
              nodes {elements.nodes.length} · edges {elements.edges.length}
            </span>
          </div>
          {!detail ? (
            <p className="text-[hsl(var(--neo-soft-text))]">
              Tap a node to inspect its dependencies. Double-tap to focus on its
              neighborhood.
            </p>
          ) : (
            <div className="space-y-2 break-all">
              <p className="font-semibold text-[var(--neo-accent,#2563eb)]">
                {detail.fullPath}
              </p>
              {detail.kind === "group" ? (
                <p>
                  <span className="text-[hsl(var(--neo-soft-text))]">
                    Files
                  </span>
                  : {detail.size ?? 0}
                </p>
              ) : (
                <>
                  {detail.dir ? (
                    <p>
                      <span className="text-[hsl(var(--neo-soft-text))]">
                        Directory
                      </span>
                      : {detail.dir}
                    </p>
                  ) : null}
                  <p>
                    <span className="text-[hsl(var(--neo-soft-text))]">
                      fan-in
                    </span>
                    : {detail.fanIn ?? 0} ·{" "}
                    <span className="text-[hsl(var(--neo-soft-text))]">
                      fan-out
                    </span>
                    : {detail.fanOut ?? 0}
                  </p>
                  <p>
                    <span className="text-[hsl(var(--neo-soft-text))]">
                      matched
                    </span>
                    : {detail.matched ? "yes" : "no"} ·{" "}
                    <span className="text-[hsl(var(--neo-soft-text))]">
                      external
                    </span>
                    : {detail.external ? "yes" : "no"} ·{" "}
                    <span className="text-[hsl(var(--neo-soft-text))]">
                      orphan
                    </span>
                    : {detail.orphan ? "yes" : "no"}
                  </p>
                </>
              )}
              {detail.outgoing.length ? (
                <div>
                  <p className="text-[hsl(var(--neo-soft-text))]">
                    → depends on
                  </p>
                  <ul className="ml-4 list-disc">
                    {detail.outgoing.slice(0, 80).map((value) => (
                      <li key={`out-${value}`}>{value}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {detail.incoming.length ? (
                <div>
                  <p className="text-[hsl(var(--neo-soft-text))]">
                    ← depended by
                  </p>
                  <ul className="ml-4 list-disc">
                    {detail.incoming.slice(0, 80).map((value) => (
                      <li key={`in-${value}`}>{value}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default ImportGraphCytoscape;
