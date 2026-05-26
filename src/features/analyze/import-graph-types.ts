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
  orphan: boolean;
  circular: boolean;
}

export interface ImportGraphEdge {
  from: string;
  to: string;
  specifier: string;
  kind: ImportEdgeKind;
  dynamic: boolean;
  circular: boolean;
}

export interface ImportGraphModuleDependency {
  to: string;
  specifier: string;
  kind: ImportEdgeKind;
  dynamic: boolean;
  circular: boolean;
}

export interface ImportGraphModule {
  source: string;
  orphan: boolean;
  circular: boolean;
  deps: ImportGraphModuleDependency[];
}

export interface ImportGraphExternalEdge {
  from: string;
  to: string;
  absolutePath: string;
  specifier: string;
  kind: ImportEdgeKind;
  dynamic: boolean;
}

export interface ImportGraphSummary {
  totalCruised: number;
  totalDependenciesCruised: number;
  generatedAt: string;
  circularEdges: number;
}

export interface ImportGraphResult {
  nodes: ImportGraphNode[];
  edges: ImportGraphEdge[];
  modules: ImportGraphModule[];
  externalEdges: ImportGraphExternalEdge[];
  summary: ImportGraphSummary;
  mermaid: string;
  truncated: boolean;
  totalSourceFiles: number;
  totalResolvedEdges: number;
  totalUnresolvedImports: number;
}
