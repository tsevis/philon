export type Profile = "Fast" | "Balanced" | "Verified";

export type WarningRecord = {
  code: string;
  message: string;
  page?: number;
  block_id?: string;
  severity: "warning" | "error";
};

export type OutputPaths = {
  machine?: string;
  markdown: string;
  html: string;
  ir: string;
  page_tree?: string;
  chunks: string;
  embeddings?: string;
  evidence: string;
  table_csv?: string[];
  table_csv_manifest?: string;
  manifest?: string;
  assets?: string[];
  overlay_diagnostics?: string[];
  extracted_assets?: { manifest: string; items: Array<{ id: string; path: string; bytes: number; bytes_sha256: string; source_pages: number[]; source_references?: Array<{ page: number; object_name: string }>; original_name: string; kind: string; format?: string; mime_type?: string; pixel_width?: number | null; pixel_height?: number | null; extraction_method?: string }> };
};

export type PageResult = {
  id: string;
  number: number;
  width: number;
  height: number;
  method: string;
  confidence: number;
  /** The page's own /Rotate. Measurements below are reconciled into the frame it is displayed in. */
  rotation?: number;
  route?: { decision: string; reason: string; suggested_dpi: number | null; automatic_model_execution: boolean };
  source_artifacts?: { numeric_markers: Array<{ text: string; bbox: BlockResult["bbox"] }> };
  /** Grids measured from the rules this page draws. An incomplete one encloses no proven cells. */
  ruled_tables?: Array<{ bbox: BlockResult["bbox"]; row_count: number; column_count: number; complete: boolean; recoverable: boolean; crossing_count: number }>;
  block_ids: string[];
};

export type BlockResult = {
  id: string;
  page: string;
  type: "heading" | "paragraph" | "table" | "formula" | "figure" | "caption" | "citation";
  level?: number | null;
  text: string;
  bbox?: { x0: number; y0: number; x1: number; y1: number; coordinate_space: string; origin: "bottom-left" } | null;
  source: { method: string; confidence: number; language: string };
  /** Link annotations the PDF declared, measured onto the characters they cover. */
  links?: Array<{ uri: string; text: string; bbox?: BlockResult["bbox"] }>;
  /** Cells recovered from the rules the page drew around them, never from alignment. */
  table?: { rows: string[][]; row_count: number; column_count: number; source: string; spans?: Array<Array<{ rowspan: number; colspan: number } | null>>; column_lines?: number[] } | null;
  /** A formula written back out with the scripts the page's own geometry proved. */
  formula?: { typeset: string; source: string } | null;
  evidence: { validation: string[]; alternatives: unknown[]; repair_history: unknown[]; findings?: Record<string, unknown> };
  review?: { action: string; at: string; actor: string; status?: string; reason?: string };
};

export type DocumentResult = {
  id: string;
  source_path: string;
  status: "completed" | "completed_with_warnings";
  outputs: OutputPaths;
  evidence_report?: { summary: { pages: number; blocks: number; average_block_confidence: number; warnings: number; tables: number; formula_candidates: number; manual_recognition_routes: number }; accessibility: { status: string; findings: Array<{ rule: string; status: string; message: string }> } };
  warnings: WarningRecord[];
  pages: PageResult[];
  blocks: BlockResult[];
  cache_hit: boolean;
  created_at: string;
};

export type ConversionResult = {
  id: string;
  profile: Profile;
  local_only: boolean;
  results: DocumentResult[];
  failures: Array<{ source_path: string; error: string }>;
  created_at: string;
};

export type HistoryItem = {
  id: string;
  created_at: string;
  profile: Profile;
  status: string;
  documents: number;
  warnings: number;
  payload?: ConversionResult;
};

export type PreflightItem = {
  source_path: string;
  status: "ready" | "blocked";
  route?: string;
  preflight?: { kind: "pdf" | "image"; bytes: number; declared_page_count: number | null };
  error?: string;
};

export type BatchItem = {
  id: string;
  batch_id: string;
  source_path: string;
  status: "queued" | "running" | "paused" | "cancelled" | "completed" | "completed_with_warnings" | "failed";
  error?: string | null;
  result?: DocumentResult | null;
  created_at: string;
  updated_at: string;
};

export type ModelPack = {
  id: string;
  role: string;
  required: boolean;
  approved: boolean;
  installed: boolean;
  available_locally?: boolean;
  local_path?: string | null;
  license: string;
  runtime: string;
  distribution: string;
  integrity: string | null;
  readiness?: "ready" | "available" | "probe-required" | "incomplete" | "not-found" | "unavailable" | "blocked";
  diagnostics?: string[];
  /** Whether the manifest declares files Philon can fetch for this pack. */
  downloadable?: boolean;
  /** What that fetch would transfer, declared in the manifest rather than asked of a host. */
  download_bytes?: number | null;
  /** Whether every declared file carries a SHA-256 that will be checked before install. */
  download_verified?: boolean;
  /** Whether the copy in use is one Philon fetched, rather than one already on the machine. */
  managed?: boolean;
};
