import type { ImportGraphResult } from "~/features/analyze/import-graph-types";

export type {
  ImportEdgeKind,
  ImportGraphEdge,
  ImportGraphNode,
  ImportGraphResult,
} from "~/features/analyze/import-graph-types";

export async function fetchImportGraph(localPath: string): Promise<ImportGraphResult> {
  const response = await fetch("/api/analyze/import-graph", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      local_path: localPath,
    }),
  });

  const responseText = await response.text();
  let data: {
    ok?: boolean;
    graph?: ImportGraphResult;
    error?: string;
  };

  try {
    data = JSON.parse(responseText) as typeof data;
  } catch {
    throw new Error(
      response.ok
        ? "Import graph API returned an invalid response."
        : `Import graph API failed (${response.status}).`,
    );
  }

  if (!response.ok || !data.graph) {
    throw new Error(data.error ?? "Failed to build import dependency graph.");
  }

  return data.graph;
}
