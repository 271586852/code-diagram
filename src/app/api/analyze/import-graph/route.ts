import { NextResponse } from "next/server";
import { z } from "zod";

import { buildImportDependencyGraph } from "~/server/analyze/import-graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const importGraphRequestSchema = z.object({
  local_path: z.string().min(1),
  max_nodes: z.number().int().positive().max(500).optional(),
  max_edges: z.number().int().positive().max(1000).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = importGraphRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "Invalid request payload.",
          error_code: "VALIDATION_ERROR",
        },
        { status: 400 },
      );
    }

    const graph = await buildImportDependencyGraph({
      localPath: parsed.data.local_path,
      maxNodes: parsed.data.max_nodes,
      maxEdges: parsed.data.max_edges,
    });

    return NextResponse.json({
      ok: true,
      graph,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to build import dependency graph.",
        error_code: "IMPORT_GRAPH_FAILED",
      },
      { status: 500 },
    );
  }
}
