export type ImportEdgeKind =
  | "static-import"
  | "export"
  | "dynamic-import"
  | "require";

export interface ImportGraphNode {
  id: string;
  path: string;
  importCount: number;
  importedByCount: number;
}

export interface ImportGraphEdge {
  from: string;
  to: string;
  specifier: string;
  kind: ImportEdgeKind;
}

export interface ImportGraphResult {
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];
  mermaid: string;
  truncated: boolean;
  totalSourceFiles: number;
  totalResolvedEdges: number;
  totalUnresolvedImports: number;
}
