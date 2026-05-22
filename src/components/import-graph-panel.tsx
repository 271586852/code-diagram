"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import MermaidChart from "~/components/mermaid-diagram";
import {
  fetchImportGraph,
  type ImportGraphResult,
} from "~/features/analyze/import-graph";

const ImportGraphCytoscape = dynamic(
  () =>
    import("~/components/import-graph-cytoscape").then(
      (mod) => mod.ImportGraphCytoscape,
    ),
  { ssr: false },
);

interface ImportGraphPanelProps {
  localPath: string;
  zoomingEnabled: boolean;
}

type RenderMode = "cytoscape" | "mermaid";

export function ImportGraphPanel({
  localPath,
  zoomingEnabled,
}: ImportGraphPanelProps) {
  const [graph, setGraph] = useState<ImportGraphResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renderMode, setRenderMode] = useState<RenderMode>("cytoscape");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchImportGraph(localPath)
      .then((result) => {
        if (cancelled) return;
        setGraph(result);
      })
      .catch((nextError: unknown) => {
        if (cancelled) return;
        setError(
          nextError instanceof Error
            ? nextError.message
            : "Failed to build import dependency graph.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [localPath]);

  if (loading) {
    return (
      <div className="neo-panel w-full max-w-5xl rounded-lg p-5 text-center font-semibold">
        Building AST import dependency graph...
      </div>
    );
  }

  if (error) {
    return (
      <div className="neo-panel w-full max-w-5xl rounded-lg p-5 text-center text-sm font-semibold text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!graph) {
    return null;
  }

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <div className="neo-panel w-full max-w-5xl rounded-lg p-4">
        <div className="grid gap-3 text-sm font-semibold text-black sm:grid-cols-4 dark:text-neutral-100">
          <div>
            <div className="text-xs tracking-[0.14em] text-[hsl(var(--neo-soft-text))] uppercase">
              Source files
            </div>
            <div className="mt-1 text-lg">{graph.totalSourceFiles}</div>
          </div>
          <div>
            <div className="text-xs tracking-[0.14em] text-[hsl(var(--neo-soft-text))] uppercase">
              Import edges
            </div>
            <div className="mt-1 text-lg">{graph.totalResolvedEdges}</div>
          </div>
          <div>
            <div className="text-xs tracking-[0.14em] text-[hsl(var(--neo-soft-text))] uppercase">
              Rendered
            </div>
            <div className="mt-1 text-lg">
              {graph.nodes.length} / {graph.edges.length}
            </div>
          </div>
          <div>
            <div className="text-xs tracking-[0.14em] text-[hsl(var(--neo-soft-text))] uppercase">
              Unresolved
            </div>
            <div className="mt-1 text-lg">{graph.totalUnresolvedImports}</div>
          </div>
        </div>
        {graph.truncated ? (
          <p className="mt-3 text-sm font-medium text-[hsl(var(--neo-soft-text))]">
            The rendered graph is capped for readability. The counts still reflect
            the full AST import scan.
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="font-medium text-[hsl(var(--neo-soft-text))]">
            Renderer:
          </span>
          <button
            type="button"
            onClick={() => setRenderMode("cytoscape")}
            className={`rounded border px-2 py-1 ${
              renderMode === "cytoscape"
                ? "border-[var(--neo-accent,#2563eb)] bg-[var(--neo-accent,#2563eb)] text-white"
                : "border-neutral-300 bg-white text-black dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            }`}
          >
            Interactive (Cytoscape)
          </button>
          <button
            type="button"
            onClick={() => setRenderMode("mermaid")}
            className={`rounded border px-2 py-1 ${
              renderMode === "mermaid"
                ? "border-[var(--neo-accent,#2563eb)] bg-[var(--neo-accent,#2563eb)] text-white"
                : "border-neutral-300 bg-white text-black dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
            }`}
          >
            Mermaid (static)
          </button>
        </div>
      </div>

      <div className="flex w-full justify-center px-4">
        {renderMode === "cytoscape" ? (
          <ImportGraphCytoscape graph={graph} />
        ) : (
          <MermaidChart chart={graph.mermaid} zoomingEnabled={zoomingEnabled} />
        )}
      </div>
    </div>
  );
}
