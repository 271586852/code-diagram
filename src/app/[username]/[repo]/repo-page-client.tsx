"use client";

import { useCallback, useEffect, useState } from "react";
import type { DiagramStateResponse } from "~/features/diagram/types";
import MainCard from "~/components/main-card";
import Loading from "~/components/loading";
import MermaidChart from "~/components/mermaid-diagram";
import { GenerationAuditPanel } from "~/components/generation-audit-panel";
import { useDiagram } from "~/hooks/useDiagram";
import { ApiKeyDialog } from "~/components/api-key-dialog";
import { ApiKeyButton } from "~/components/api-key-button";
import { useStarReminder } from "~/hooks/useStarReminder";
import { SponsorSlot } from "~/components/sponsor-slot";
import { ImportGraphPanel } from "~/components/import-graph-panel";

type RepoPageClientProps = {
  username: string;
  repo: string;
  localPath?: string;
  initialState?: DiagramStateResponse | null;
};

export default function RepoPageClient({
  username,
  repo,
  localPath,
  initialState = null,
}: RepoPageClientProps) {
  const [zoomingEnabled, setZoomingEnabled] = useState(false);
  const [diagramRendered, setDiagramRendered] = useState(false);
  const [activeView, setActiveView] = useState<"architecture" | "imports">(
    "architecture",
  );

  useStarReminder();

  const normalizedUsername = username.toLowerCase();
  const normalizedRepo = repo.toLowerCase();

  const {
    diagram,
    error,
    loading,
    lastGenerated,
    showApiKeyDialog,
    handleCopy,
    handleApiKeySubmit,
    handleCloseApiKeyDialog,
    handleOpenApiKeyDialog,
    handleExportImage,
    handleRegenerate,
    handleDiagramRenderError,
    state,
  } = useDiagram(normalizedUsername, normalizedRepo, initialState, localPath);

  const hasDiagram = Boolean(diagram);
  const hasError = Boolean(error || state.error);

  const handleDiagramRenderComplete = useCallback(() => {
    setDiagramRendered(true);
  }, []);

  useEffect(() => {
    setDiagramRendered(false);
  }, [diagram, zoomingEnabled]);

  return (
    <div className="flex flex-col items-center p-4">
      <div className="flex w-full justify-center pt-8">
        <MainCard
          isHome={false}
          username={normalizedUsername}
          repo={normalizedRepo}
          localPath={localPath}
          hasDiagram={hasDiagram}
          onCopy={handleCopy}
          lastGenerated={lastGenerated}
          actualCost={
            state.costSummary?.kind === "actual"
              ? state.costSummary.display
              : undefined
          }
          onExportImage={handleExportImage}
          onRegenerate={handleRegenerate}
          zoomingEnabled={zoomingEnabled}
          onZoomToggle={() => setZoomingEnabled((prev) => !prev)}
          loading={loading}
        />
      </div>
      <div className="mt-8 flex w-full flex-col items-center gap-8">
        {localPath ? (
          <div className="inline-flex rounded-md border-[3px] border-black bg-[hsl(var(--neo-panel))] p-1 dark:border-[#1a0d30]">
            <button
              type="button"
              onClick={() => setActiveView("architecture")}
              className={`rounded-sm px-4 py-2 text-sm font-bold ${
                activeView === "architecture"
                  ? "bg-[hsl(var(--neo-button))] text-black"
                  : "text-black dark:text-neutral-100"
              }`}
            >
              Architecture
            </button>
            <button
              type="button"
              onClick={() => setActiveView("imports")}
              className={`rounded-sm px-4 py-2 text-sm font-bold ${
                activeView === "imports"
                  ? "bg-[hsl(var(--neo-button))] text-black"
                  : "text-black dark:text-neutral-100"
              }`}
            >
              Import Dependencies
            </button>
          </div>
        ) : null}

        {activeView === "imports" && localPath ? (
          <ImportGraphPanel
            localPath={localPath}
            zoomingEnabled={zoomingEnabled}
          />
        ) : loading ? (
          <Loading
            costSummary={state.costSummary}
            status={state.status}
            message={state.message}
            explanation={state.explanation}
            graph={state.graph}
            graphAttempts={state.graphAttempts}
            validationError={state.validationError}
            diagram={state.diagram}
          />
        ) : (
          <div className="flex w-full flex-col items-center gap-8">
            {hasDiagram && activeView === "architecture" && (
              <>
                <div className="flex w-full justify-center px-4">
                  <MermaidChart
                    chart={diagram}
                    zoomingEnabled={zoomingEnabled}
                    onRenderError={handleDiagramRenderError}
                    onRenderComplete={handleDiagramRenderComplete}
                  />
                </div>
                {diagramRendered && (
                  <SponsorSlot
                    surface="diagram"
                    className="mx-4 mb-8 max-w-5xl sm:mb-12"
                  />
                )}
              </>
            )}
            {hasError && (
              <div className="w-full max-w-5xl text-center">
                <GenerationAuditPanel
                  audit={state.latestSessionAudit}
                  error={error || state.error}
                />
                {(error?.includes("API key") ||
                  state.error?.includes("API key")) && (
                  <div className="mt-8 flex flex-col items-center gap-2">
                    <ApiKeyButton onClick={handleOpenApiKeyDialog} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <ApiKeyDialog
        isOpen={showApiKeyDialog}
        onClose={handleCloseApiKeyDialog}
        onSubmit={handleApiKeySubmit}
      />
    </div>
  );
}
