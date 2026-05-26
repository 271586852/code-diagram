"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const [currentPath, setCurrentPath] = useState(localPath);
  const [historyPaths, setHistoryPaths] = useState<string[]>([localPath]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const currentPathRef = useRef(currentPath);
  const historyPathsRef = useRef(historyPaths);
  const historyIndexRef = useRef(historyIndex);

  useEffect(() => {
    currentPathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    historyPathsRef.current = historyPaths;
  }, [historyPaths]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  const syncUrl = useCallback(
    (nextPath: string, mode: "pushState" | "replaceState") => {
      if (typeof window === "undefined") return;
      const url = new URL(window.location.href);
      url.searchParams.set("path", nextPath);
      window.history[mode]({ path: nextPath }, "", url);
    },
    [],
  );

  const navigateToPath = useCallback(
    (nextPath: string) => {
      const normalized = nextPath.trim();
      if (!normalized || normalized === currentPathRef.current) return;

      const baseHistory = historyPathsRef.current.slice(0, historyIndexRef.current + 1);
      const nextHistory = [...baseHistory, normalized];
      const nextIndex = nextHistory.length - 1;

      setCurrentPath(normalized);
      setHistoryPaths(nextHistory);
      setHistoryIndex(nextIndex);
      syncUrl(normalized, "pushState");
    },
    [syncUrl],
  );

  useEffect(() => {
    setCurrentPath(localPath);
    setHistoryPaths([localPath]);
    setHistoryIndex(0);
    syncUrl(localPath, "replaceState");
  }, [localPath, syncUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = () => {
      const nextPath = new URL(window.location.href).searchParams.get("path");
      if (!nextPath) return;

      setCurrentPath(nextPath);

      const existingIndex = historyPathsRef.current.lastIndexOf(nextPath);
      if (existingIndex >= 0) {
        setHistoryIndex(existingIndex);
        return;
      }

      const nextHistory = [...historyPathsRef.current, nextPath];
      setHistoryPaths(nextHistory);
      setHistoryIndex(nextHistory.length - 1);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchImportGraph(currentPath)
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
  }, [currentPath]);

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < historyPaths.length - 1;

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
        <div className="grid gap-3 text-sm font-semibold text-black sm:grid-cols-5 dark:text-neutral-100">
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
              Circular
            </div>
            <div className="mt-1 text-lg">{graph.summary.circularEdges}</div>
          </div>
          <div>
            <div className="text-xs tracking-[0.14em] text-[hsl(var(--neo-soft-text))] uppercase">
              Unresolved
            </div>
            <div className="mt-1 text-lg">{graph.totalUnresolvedImports}</div>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-neutral-200/70 bg-white/60 p-3 dark:border-neutral-800 dark:bg-neutral-950/30">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-[hsl(var(--neo-soft-text))]">
              Directory history:
            </span>
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => {
                if (!canGoBack || typeof window === "undefined") return;
                window.history.back();
              }}
              className={`rounded border px-2 py-1 ${
                canGoBack
                  ? "border-neutral-300 bg-white text-black dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  : "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-600"
              }`}
            >
              后退
            </button>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => {
                if (!canGoForward || typeof window === "undefined") return;
                window.history.forward();
              }}
              className={`rounded border px-2 py-1 ${
                canGoForward
                  ? "border-neutral-300 bg-white text-black dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
                  : "cursor-not-allowed border-neutral-200 bg-neutral-100 text-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-600"
              }`}
            >
              前进
            </button>
            <span className="text-[hsl(var(--neo-soft-text))]">
              {historyIndex + 1} / {historyPaths.length}
            </span>
          </div>

          <div className="text-xs">
            <div className="font-medium text-[hsl(var(--neo-soft-text))]">
              Current directory
            </div>
            <div className="mt-1 break-all font-mono text-[11px] text-black dark:text-neutral-100">
              {currentPath}
            </div>
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
          <ImportGraphCytoscape
            graph={graph}
            localPath={currentPath}
            onDirectorySelect={navigateToPath}
          />
        ) : (
          <MermaidChart chart={graph.mermaid} zoomingEnabled={zoomingEnabled} />
        )}
      </div>
    </div>
  );
}
