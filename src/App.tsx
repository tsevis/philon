import { open } from "@tauri-apps/plugin-dialog";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Archive,
  ArrowClockwise,
  BookOpenText,
  CaretLeft,
  CaretRight,
  CheckCircle,
  ClipboardText,
  CloudSlash,
  CircleNotch,
  DownloadSimple,
  FileArrowUp,
  FilePdf,
  FolderOpen,
  Gauge,
  GearSix,
  Info,
  ImageSquare,
  ListChecks,
  MagicWand,
  Play,
  ShieldCheck,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { BatchItem, BlockResult, ConversionResult, DocumentResult, HistoryItem, ModelPack, PreflightItem, Profile } from "./lib/types";
import { basename, bytesLabel, confidenceLabel } from "./lib/format";
import type { OutputChoice, Preferences } from "./lib/preferences";
import { defaultPreferences, loadPreferences, outputChoices, profiles } from "./lib/preferences";
import { Splash, rememberSplashSeen, splashWanted } from "./Splash";
import makersMark from "./assets/makers-mark.png";

type Tab = "single" | "batch";
type SidebarView = "workspace" | "library" | "models" | "diagnostics" | "settings";
type TaskKind = "conversion" | "preflight" | "repair" | "export" | "library" | "models";
type TaskProgress = { jobId: string; kind: TaskKind; stage: string; message: string; percent?: number; current?: number; total?: number; sourcePath?: string; indeterminate?: boolean };

const fileFilters = [{ name: "Documents", extensions: ["pdf", "png", "jpg", "jpeg", "tiff", "tif", "webp"] }];

function newTaskId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `philon-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function TaskProgressBar({ progress }: { progress: TaskProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent || 0)));
  const isIndeterminate = Boolean(progress.indeterminate);
  const title = progress.kind === "preflight" ? "Inspecting files" : progress.kind === "repair" ? "Repairing selected block" : progress.kind === "export" ? "Exporting conversion" : progress.kind === "library" ? "Loading local library" : progress.kind === "models" ? "Inspecting local models" : "Converting locally";
  return <section className="task-progress" aria-label={title} aria-live="polite">
    <div className="task-progress-heading"><span><CircleNotch size={15} weight="bold" /> {title}</span><strong>{isIndeterminate ? "Working" : `${percent}%`}</strong></div>
    <div className={`task-progress-track ${isIndeterminate ? "is-indeterminate" : ""}`} role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} {...(!isIndeterminate ? { "aria-valuenow": percent } : {})}><span style={isIndeterminate ? undefined : { width: `${percent}%` }} /></div>
    <div className="task-progress-detail"><span>{progress.message}</span>{progress.current && progress.total ? <b>{progress.current} of {progress.total}</b> : progress.sourcePath ? <b>{basename(progress.sourcePath)}</b> : null}</div>
  </section>;
}

function ProfilePicker({ profile, onChange }: { profile: Profile; onChange: (profile: Profile) => void }) {
  return (
    <div className="profile-picker" aria-label="Conversion profile">
      {profiles.map((item) => (
        <button key={item.name} className={`profile-choice ${profile === item.name ? "is-active" : ""}`} onClick={() => onChange(item.name)} type="button" title={item.description} aria-label={`${item.name}: ${item.description}`}>
          {item.name}
        </button>
      ))}
    </div>
  );
}

type EvidenceCandidate = { kind?: string; text: string; selected?: boolean; model?: string; source_crop?: string; quality?: { status?: string; issues?: string[] } };

function changedTokenCount(before: string, after: string) {
  const beforeTokens = before.toLowerCase().match(/\S+/g) || [];
  const afterTokens = after.toLowerCase().match(/\S+/g) || [];
  const beforeCounts = new Map<string, number>();
  for (const token of beforeTokens) beforeCounts.set(token, (beforeCounts.get(token) || 0) + 1);
  let shared = 0;
  for (const token of afterTokens) {
    const count = beforeCounts.get(token) || 0;
    if (count) { shared += 1; beforeCounts.set(token, count - 1); }
  }
  return Math.max(beforeTokens.length, afterTokens.length) - shared;
}

function EvidencePanel({ document, selectedBlockId, onSelectBlock, onReview, onRestoreCandidate, onRepair }: { document: DocumentResult | null; selectedBlockId: string | null; onSelectBlock: (blockId: string) => void; onReview: (blockId: string, action: "accept" | "edit" | "ignore_warning") => void; onRestoreCandidate: (blockId: string, candidateIndex: number) => void; onRepair: (blockId: string, mode: "transcription" | "table" | "formula") => void }) {
  const block = document?.blocks.find((item) => item.id === selectedBlockId) || document?.blocks[0];
  const extractedAssets = document?.outputs.extracted_assets?.items || [];
  const candidates: EvidenceCandidate[] = Array.isArray(block?.evidence.alternatives) ? block.evidence.alternatives.filter((item): item is EvidenceCandidate => Boolean(item) && typeof item === "object" && typeof (item as EvidenceCandidate).text === "string") : [];
  const [comparedCandidateIndex, setComparedCandidateIndex] = useState<number | null>(null);
  const comparedCandidate = comparedCandidateIndex === null ? null : candidates[comparedCandidateIndex] || null;
  useEffect(() => setComparedCandidateIndex(null), [block?.id]);
  if (!document) {
    return (
      <aside className="evidence-panel empty-evidence">
        <div className="eyebrow"><ShieldCheck size={14} weight="fill" /> Evidence</div>
        <h2>Nothing hidden.</h2>
        <p>Every converted block will show its source, confidence, and validation record here.</p>
      </aside>
    );
  }
  return (
    <aside className="evidence-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow"><ShieldCheck size={14} weight="fill" /> Evidence</div>
          <h2>{document.warnings.length ? "Review queue" : "Verified output"}</h2>
        </div>
        <span className={`status-mark ${document.warnings.length ? "caution" : "success"}`}>{document.warnings.length ? document.warnings.length : <CheckCircle size={16} weight="fill" />}</span>
      </div>
      <div className="evidence-summary">
        <span>Source method</span>
        <strong>{block?.source.method.replaceAll("-", " ") || "Awaiting conversion"}</strong>
        <span>Confidence</span>
        <strong>{block ? `${Math.round(block.source.confidence * 100)}% ${confidenceLabel(block.source.confidence).toLowerCase()}` : "Not measured"}</strong>
        <span>Route</span>
        <strong>{document.pages.find((page) => page.id === block?.page)?.route?.decision.replaceAll("-", " ") || "Not recorded"}</strong>
        <span>Source region</span>
        <strong>{block?.bbox ? `Measured · ${block.bbox.coordinate_space.replaceAll("-", " ")}` : "No measured region"}</strong>
        <span>Native assets</span>
        <strong>{document.outputs.extracted_assets ? `${document.outputs.extracted_assets.items.length} extracted with provenance` : "None extracted"}</strong>
        <span>Source markers</span>
        <strong>{document.pages.find((page) => page.id === block?.page)?.source_artifacts?.numeric_markers.length || "None"}</strong>
        <span>Overlay diagnostics</span>
        <strong>{document.outputs.overlay_diagnostics?.length ? `${document.outputs.overlay_diagnostics.length} pages mapped` : "No measured overlays"}</strong>
      </div>
      {extractedAssets.length > 0 && <section className="asset-shelf" aria-label="Extracted PDF images"><header><span><ImageSquare size={15} weight="fill" /> Extracted images</span><b>{extractedAssets.length}</b></header><div className="asset-strip">{extractedAssets.slice(0, 8).map((asset) => <a className="asset-card" href={convertFileSrc(asset.path)} key={asset.id} target="_blank" rel="noreferrer" title={`Open ${asset.original_name}`}><span className="asset-thumbnail">{asset.mime_type?.startsWith("image/") ? <img src={convertFileSrc(asset.path)} alt={`Extracted image ${asset.id} from page ${asset.source_pages.join(", ")}`} loading="lazy" /> : <ImageSquare size={22} />}</span><strong>{asset.pixel_width && asset.pixel_height ? `${asset.pixel_width} × ${asset.pixel_height}` : asset.format || "Image"}</strong><small>p. {asset.source_pages.join(", ")}</small></a>)}</div>{extractedAssets.length > 8 && <p className="asset-shelf-note">Showing 8 of {extractedAssets.length}. The full set and manifest are in this conversion’s extracted-assets folder.</p>}</section>}
      {document.warnings.length > 0 ? (
        <div className="warning-list">
          {document.warnings.map((warning, index) => (
            <article className="warning-item" key={`${warning.code}-${index}`}>
              <WarningCircle size={18} weight="fill" />
              <div><strong>{warning.code.replaceAll("_", " ")}</strong><p>{warning.message}</p></div>
            </article>
          ))}
        </div>
      ) : (
        <div className="verified-note"><CheckCircle size={20} weight="fill" /> Native text and reading order passed the active checks.</div>
      )}
      {block && candidates.length > 0 && <section className="candidate-shelf" aria-label="Retained output candidates"><header><span><MagicWand size={15} weight="fill" /> Retained candidates</span><b>{candidates.length}</b></header>{comparedCandidate && <section className="candidate-compare" aria-label="Candidate comparison"><header><strong>Compare before applying</strong><button type="button" onClick={() => setComparedCandidateIndex(null)} aria-label="Close candidate comparison"><X size={13} /></button></header><span>{changedTokenCount(block.text, comparedCandidate.text)} changed token{changedTokenCount(block.text, comparedCandidate.text) === 1 ? "" : "s"} · source evidence remains retained</span><div><article><small>Current export</small><p>{block.text}</p></article><article><small>{(comparedCandidate.model || comparedCandidate.kind || "Candidate").replaceAll("-", " ")}</small><p>{comparedCandidate.text}</p></article></div></section>}<div className="candidate-list">{candidates.map((candidate, index) => <article className="candidate-item" key={`${candidate.kind || "candidate"}-${index}`}><div><strong>{(candidate.model || candidate.kind || "Retained candidate").replaceAll("-", " ")}</strong><span>{candidate.selected ? "Currently selected" : candidate.quality?.status === "review-required" ? `Format review required${candidate.quality.issues?.length ? ` · ${candidate.quality.issues.join(" ")}` : ""}` : "Unselected · source retained"}</span></div><p>{candidate.text}</p><div className="candidate-actions">{candidate.source_crop && <a href={convertFileSrc(candidate.source_crop)} target="_blank" rel="noreferrer">View source crop</a>}<button className="review-button" type="button" onClick={() => setComparedCandidateIndex(index)}>Compare</button><button className="review-button" type="button" onClick={() => onRestoreCandidate(block.id, index)} disabled={candidate.selected}>Use this candidate</button></div></article>)}</div></section>}
      <div className="block-list" aria-label={`Extracted blocks: ${document.blocks.length} total`}>
        {document.blocks.map((item) => (
          <button className={block?.id === item.id ? "is-selected" : ""} key={item.id} onClick={() => onSelectBlock(item.id)} type="button">
            <span>{item.type}</span><b>{item.text.slice(0, 52) || "No text extracted"}</b><CaretRight size={15} />
          </button>
        ))}
      </div>
      {block && <div className="review-actions"><button className="review-button" type="button" onClick={() => onReview(block.id, "accept")}><CheckCircle size={15} /> Accept source</button><button className="review-button" type="button" onClick={() => onReview(block.id, "edit")}><ClipboardText size={15} /> Edit text</button><button className="review-button" type="button" onClick={() => onRepair(block.id, "transcription")}>Rerun with Qwen</button><button className="review-button" type="button" onClick={() => onReview(block.id, "ignore_warning")}>Ignore warning</button></div>}
      <div className="repair-modes" aria-label="Qwen repair mode"><button type="button" onClick={() => block && onRepair(block.id, "transcription")}>Text</button><button type="button" onClick={() => block && onRepair(block.id, "table")}>Table</button><button type="button" onClick={() => block && onRepair(block.id, "formula")}>Formula</button></div>
      <button className="repair-button" type="button" onClick={() => block && onRepair(block.id, "transcription")}>
        <MagicWand size={17} /> Repair selected block <span>Qwen 3.8 · manual only</span>
      </button>
    </aside>
  );
}

function SourcePanel({ path, document, selectedBlockId, onSelectPage }: { path: string | null; document: DocumentResult | null; selectedBlockId: string | null; onSelectPage: (pageNumber: number) => void }) {
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number } | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState<"fit" | 0.75 | 1 | 1.25 | 1.5>("fit");
  const selectedBlock = document?.blocks.find((block) => block.id === selectedBlockId) || document?.blocks[0];
  const selectedPage = document?.pages.find((page) => page.id === selectedBlock?.page) || document?.pages[0];
  const selectedPageBlocks = document && selectedBlock ? document.blocks.filter((block) => block.page === selectedBlock.page) : document?.blocks;
  const previewText = selectedPageBlocks?.map((block) => block.text).join("\n\n") || "No source loaded.";
  const previewPath = document?.outputs.assets?.[(selectedPage?.number || 1) - 1];
  const regionLabel = selectedBlock?.bbox
    ? `Measured p${selectedBlock.page.replace("page-", "")} · ${selectedBlock.bbox.coordinate_space.replaceAll("-", " ")}`
    : "No measured source region";
  const overlay = selectedBlock?.bbox && selectedPage ? (() => {
    const box = selectedBlock.bbox;
    const normalized = box.coordinate_space === "normalized-image";
    const width = normalized ? 1 : selectedPage.width;
    const height = normalized ? 1 : selectedPage.height;
    return { left: `${(box.x0 / width) * 100}%`, top: `${((height - box.y1) / height) * 100}%`, width: `${((box.x1 - box.x0) / width) * 100}%`, height: `${((box.y1 - box.y0) / height) * 100}%` };
  })() : null;
  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame || !selectedPage?.width || !selectedPage?.height) return;
    const fitPage = () => {
      const availableWidth = Math.max(1, frame.clientWidth - 20);
      const availableHeight = Math.max(1, frame.clientHeight - 20);
      const ratio = selectedPage.width / selectedPage.height;
      const width = Math.min(availableWidth, availableHeight * ratio);
      setPreviewSize({ width: Math.round(width), height: Math.round(width / ratio) });
    };
    fitPage();
    const observer = new ResizeObserver(fitPage);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [selectedPage?.id, selectedPage?.width, selectedPage?.height, previewPath]);
  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame || !overlay) return;
    const timeout = window.setTimeout(() => {
      const left = parseFloat(overlay.left) / 100;
      const top = parseFloat(overlay.top) / 100;
      frame.scrollTo({ left: Math.max(0, frame.scrollWidth * left - frame.clientWidth / 2), top: Math.max(0, frame.scrollHeight * top - frame.clientHeight / 2), behavior: "smooth" });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [selectedBlock?.id, overlay]);
  useEffect(() => { setZoom("fit"); }, [selectedPage?.id]);
  const canvasSize = zoom === "fit" ? previewSize : naturalSize ? { width: Math.round(naturalSize.width * zoom), height: Math.round(naturalSize.height * zoom) } : previewSize;
  const zoomLabel = zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`;
  return (
    <section className="source-panel">
      <header className="subpanel-header"><div><span className="eyebrow"><FilePdf size={14} weight="fill" /> Source</span><h2 title={path ? basename(path) : undefined}>{path ? basename(path) : "No source selected"}</h2></div></header>
      <div className={`paper-preview ${path ? "has-source" : ""}`}>
        <div className="paper-meta"><span>Local source</span><span>{document ? `${document.pages.length} page${document.pages.length === 1 ? "" : "s"}` : "Awaiting file"}</span></div>
        {previewPath ? <div className="source-image-frame" ref={previewFrameRef}><div className="source-page-canvas" style={canvasSize || undefined}><img className="source-image" src={convertFileSrc(previewPath)} alt={`Source page ${selectedPage?.number || 1} from ${path ? basename(path) : "document"}`} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />{overlay && <span className="source-region" style={overlay} aria-label="Measured evidence region" />}</div></div> : <div className="paper-text">{previewText.split("\n").slice(0, 22).map((line, index) => <p key={`${line}-${index}`} className={selectedPageBlocks && index === 0 ? "paper-title" : ""}>{line || " "}</p>)}</div>}
        {document && <div className="source-overlay"><span>{document.cache_hit ? "Cache evidence reused" : regionLabel}</span><span>{selectedBlock ? `${Math.round(selectedBlock.source.confidence * 100)}% block confidence` : ""}</span></div>}
      </div>
      <footer className="source-footer">
        <span><CloudSlash size={15} /> Local-only session</span>
        {previewPath && <div className="source-zoom-controls" aria-label="Source preview zoom"><button type="button" onClick={() => setZoom("fit")} className={zoom === "fit" ? "is-active" : ""}>Fit</button><button type="button" onClick={() => setZoom(zoom === "fit" ? 0.75 : Math.max(0.75, zoom - 0.25) as 0.75 | 1 | 1.25 | 1.5)} aria-label="Zoom out">−</button><span aria-live="polite">{zoomLabel}</span><button type="button" onClick={() => setZoom(zoom === "fit" ? 1 : Math.min(1.5, zoom + 0.25) as 0.75 | 1 | 1.25 | 1.5)} aria-label="Zoom in">+</button><button type="button" onClick={() => setZoom(1)} className={zoom === 1 ? "is-active" : ""}>100%</button></div>}
        {document && document.pages.length > 1 ? <div className="source-page-controls" aria-label="Source page navigation"><button type="button" onClick={() => onSelectPage(Math.max(1, (selectedPage?.number || 1) - 1))} disabled={(selectedPage?.number || 1) <= 1} aria-label="Previous page"><CaretLeft size={14} /></button><span>Page {selectedPage?.number || 1} of {document.pages.length}</span><button type="button" onClick={() => onSelectPage(Math.min(document.pages.length, (selectedPage?.number || 1) + 1))} disabled={(selectedPage?.number || 1) >= document.pages.length} aria-label="Next page"><CaretRight size={14} /></button></div> : <span>{path ? "Original never altered" : "PDF and image files only"}</span>}
      </footer>
    </section>
  );
}

function tableRows(text: string) {
  const rows = text.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|")).map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  return rows.filter((row, index) => index !== 1 || !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
}

function RenderedOutput({ document, selectedBlockId, onSelectBlock }: { document: DocumentResult; selectedBlockId: string | null; onSelectBlock: (blockId: string) => void }) {
  const assets = document.outputs.extracted_assets?.items || [];
  return <article className="rendered-document" aria-label="Rendered conversion preview">
    {document.blocks.map((block) => {
      const selected = selectedBlockId === block.id;
      const select = () => onSelectBlock(block.id);
      // `key` stays out of the spread: React 18 warns about a key arriving
      // that way, and React 19 drops it, which silently breaks reconciliation.
      const props = { className: selected ? "is-selected" : undefined, onClick: select, tabIndex: 0, role: "button" as const, "aria-label": `Inspect ${block.type} from ${block.page}`, onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } } };
      if (block.type === "heading") { const Tag = `h${Math.min(4, Math.max(1, block.level || 2))}` as "h1" | "h2" | "h3" | "h4"; return <Tag key={block.id} {...props}>{block.text}</Tag>; }
      if (block.type === "table") { const rows = tableRows(block.text); return rows.length ? <div key={block.id} {...props} className={`output-block-table ${selected ? "is-selected" : ""}`}><table><thead><tr>{rows[0].map((cell, index) => <th key={`${cell}-${index}`} scope="col">{cell}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div> : <p key={block.id} {...props}>{block.text}</p>; }
      if (block.type === "formula") return <pre key={block.id} {...props} className={`rendered-formula ${selected ? "is-selected" : ""}`}>{block.text}</pre>;
      if (block.type === "caption") return <p key={block.id} {...props} className={`rendered-caption ${selected ? "is-selected" : ""}`}>{block.text}</p>;
      return <p key={block.id} {...props}>{block.text}</p>;
    })}
    {assets.length > 0 && <section className="rendered-assets"><h2>Extracted source images</h2>{assets.map((asset) => <figure key={asset.id}><img src={convertFileSrc(asset.path)} alt={`Extracted native PDF image ${asset.id} from source page ${asset.source_pages.join(", ")}; visual description requires review.`} /><figcaption>Native asset · page {asset.source_pages.join(", ")} · {asset.pixel_width && asset.pixel_height ? `${asset.pixel_width} × ${asset.pixel_height}px` : asset.format || "image"}</figcaption></figure>)}</section>}
  </article>;
}

function OutputPanel({ document, selectedBlockId, onSelectBlock }: { document: DocumentResult | null; selectedBlockId: string | null; onSelectBlock: (blockId: string) => void }) {
  const [format, setFormat] = useState<"Preview" | "Markdown" | "IR">("Preview");
  const body = useMemo(() => {
    if (!document) return "# Evidence before output\n\nPhilon turns source structure into readable exports and keeps every uncertain region visible.";
    if (format === "IR") return JSON.stringify({ pages: document.pages, blocks: document.blocks }, null, 2);
    return document.blocks.map((block) => block.type === "heading" ? `${"#".repeat(block.level || 2)} ${block.text}` : block.type === "formula" ? `\`\`\`text\n${block.text}\n\`\`\`` : block.text).join("\n\n");
  }, [document, format]);
  return (
    <section className="output-panel">
      <header className="subpanel-header"><div><span className="eyebrow"><BookOpenText size={14} weight="fill" /> Conversion</span><h2>{format === "Preview" ? "Readable output" : `${format} export`}</h2></div><div className="format-switcher">{(["Preview", "Markdown", "IR"] as const).map((item) => <button key={item} type="button" className={item === format ? "is-active" : ""} onClick={() => setFormat(item)}>{item}</button>)}</div></header>
      {document && format === "Preview" ? <div className="output-content output-preview"><RenderedOutput document={document} selectedBlockId={selectedBlockId} onSelectBlock={onSelectBlock} /></div> : <pre className="output-content">{body}</pre>}
      <footer className="output-footer">
        <span>{document ? `${document.blocks.length} evidence-linked blocks` : "Outputs include Markdown, HTML, IR, chunks, and evidence"}</span>
        {document && <div className="output-actions">{document.outputs.marker_json && <a className="export-link" href={convertFileSrc(document.outputs.marker_json)} target="_blank" rel="noreferrer">Marker JSON</a>}<button className="export-button" type="button" onClick={() => navigator.clipboard.writeText(body)}><ClipboardText size={16} /> Copy {format === "Preview" ? "Markdown" : format}</button></div>}
      </footer>
    </section>
  );
}

function ReviewEditor({ block, onCancel, onSave }: { block: BlockResult; onCancel: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState(block.text);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => textareaRef.current?.focus(), []);
  return <div className="review-editor-backdrop" role="presentation" onMouseDown={onCancel}><section className="review-editor" role="dialog" aria-modal="true" aria-labelledby="review-editor-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="eyebrow"><ClipboardText size={14} weight="fill" /> Review edit</span><h2 id="review-editor-title">Edit exported text</h2><p>{block.type} · {block.page} · the source candidate will remain in the evidence record.</p></div><button className="icon-button" type="button" onClick={onCancel} aria-label="Close editor"><X size={18} /></button></header><label htmlFor="review-text">Replacement text</label><textarea id="review-text" ref={textareaRef} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancel(); if ((event.metaKey || event.ctrlKey) && event.key === "Enter") onSave(text); }} /><footer><span>⌘↵ saves · Esc cancels</span><div><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="button" onClick={() => onSave(text)} disabled={!text.trim()}>Save edit</button></div></footer></section></div>;
}

function App() {
  const [tab, setTab] = useState<Tab>("single");
  const [view, setView] = useState<SidebarView>("workspace");
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [profile, setProfile] = useState<Profile>(() => loadPreferences().defaultProfile);
  const [singlePath, setSinglePath] = useState<string | null>(null);
  const [batchPaths, setBatchPaths] = useState<string[]>([]);
  const [batchPreflight, setBatchPreflight] = useState<PreflightItem[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchItems, setBatchItems] = useState<BatchItem[]>([]);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [running, setRunning] = useState(false);
  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [health, setHealth] = useState<string | null>(null);
  const [models, setModels] = useState<ModelPack[]>([]);
  const [libraryCleanPending, setLibraryCleanPending] = useState(false);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [editingBlock, setEditingBlock] = useState<BlockResult | null>(null);
  const [splashOpen, setSplashOpen] = useState(splashWanted);
  const activeTaskId = useRef<string | null>(null);

  const activeDocument = result?.results[0] || null;
  const batchSummary = useMemo(() => ({
    total: batchItems.length,
    completed: batchItems.filter((item) => ["completed", "completed_with_warnings"].includes(item.status)).length,
    active: batchItems.filter((item) => item.status === "running").length,
    waiting: batchItems.filter((item) => ["queued", "paused"].includes(item.status)).length,
    failed: batchItems.filter((item) => item.status === "failed").length,
  }), [batchItems]);

  useEffect(() => { localStorage.setItem("philon.preferences.v2", JSON.stringify(preferences)); }, [preferences]);

  const updatePreferences = (next: Partial<Preferences>) => setPreferences((current) => ({ ...current, ...next }));

  const loadHistory = async (showProgress = false) => {
    const jobId = showProgress ? await beginTask("library", "Reading locally retained conversion history") : null;
    try { setHistory(await invoke<HistoryItem[]>("list_jobs")); }
    catch (caught) { if (showProgress) setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (jobId) finishTask(jobId); }
  };

  const cleanLibrary = async () => {
    const jobId = await beginTask("library", "Removing local library records");
    try {
      const reply = await invoke<{ removed: number }>("clear_library");
      setHistory([]);
      setLibraryCleanPending(false);
      setNotice(`Removed ${reply.removed} library record${reply.removed === 1 ? "" : "s"}. Exported files were kept.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { finishTask(jobId); }
  };
  useEffect(() => { void loadHistory(); }, []);

  const loadBatch = async (id: string) => {
    try {
      const items = await invoke<BatchItem[]>("list_batch_items", { batchId: id });
      setBatchItems(items);
      setBatchPaths(items.filter((item) => !["cancelled", "completed", "completed_with_warnings"].includes(item.status)).map((item) => item.source_path));
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  useEffect(() => {
    void (async () => {
      try { const id = await invoke<string | null>("latest_batch"); if (id) { setBatchId(id); await loadBatch(id); } } catch { /* Browser preview has no host. */ }
    })();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ batch_id: string }>("batch-progress", (event) => {
      if (event.payload.batch_id === batchId && batchId) void loadBatch(batchId);
    }).then((stop) => { unlisten = stop; }).catch(() => { /* Browser preview has no host. */ });
    return () => unlisten?.();
  }, [batchId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ job_id?: string; stage?: string; message?: string; percent?: number; current?: number; total?: number; source_path?: string; indeterminate?: boolean }>("conversion-progress", (event) => {
      const payload = event.payload;
      if (!payload.job_id || payload.job_id !== activeTaskId.current) return;
      setTaskProgress((current) => current ? {
        ...current,
        stage: payload.stage || current.stage,
        message: payload.message || current.message,
        percent: typeof payload.percent === "number" ? payload.percent : current.percent,
        current: typeof payload.current === "number" ? payload.current : current.current,
        total: typeof payload.total === "number" ? payload.total : current.total,
        sourcePath: payload.source_path || current.sourcePath,
        indeterminate: Boolean(payload.indeterminate),
      } : current);
    }).then((stop) => { unlisten = stop; }).catch(() => { /* Browser preview has no host. */ });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (view === "workspace" && tab === "single") void chooseSingle();
      }
      if (event.metaKey && event.key === "1") { event.preventDefault(); setView("workspace"); setTab("single"); }
      if (event.metaKey && event.key === "2") { event.preventDefault(); setView("workspace"); setTab("batch"); }
      if (event.key === "Escape") { setError(null); setNotice(null); setEditingBlock(null); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [tab, view]);

  const chooseFiles = async (multiple: boolean) => {
    const selected = await open({ multiple, directory: false, filters: fileFilters });
    if (!selected) return [];
    return Array.isArray(selected) ? selected : [selected];
  };

  const chooseSingle = async () => {
    const paths = await chooseFiles(false);
    if (paths[0]) { setSinglePath(paths[0]); setResult(null); setSelectedBlockId(null); setError(null); }
  };

  const beginTask = async (kind: TaskKind, message: string, total?: number) => {
    const jobId = newTaskId();
    activeTaskId.current = jobId;
    setTaskProgress({ jobId, kind, stage: "starting", message, percent: 0, current: total ? 1 : undefined, total });
    // Let React commit the progress surface before the native bridge begins
    // its work. This prevents a long first engine startup from looking like a
    // frozen click.
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    return jobId;
  };

  const finishTask = (jobId: string) => {
    if (activeTaskId.current !== jobId) return;
    activeTaskId.current = null;
    setTaskProgress(null);
  };

  const inspectBatch = async (paths: string[]) => {
    if (!paths.length) { setBatchPreflight([]); return; }
    const jobId = await beginTask("preflight", "Preparing local file inspection", paths.length);
    try {
      const response = await invoke<{ items: PreflightItem[] }>("preflight_conversion", { config: { inputPaths: paths, profile, jobId } });
      setBatchPreflight(response.items);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { finishTask(jobId); }
  };

  const addBatch = async () => {
    const paths = await chooseFiles(true);
    const newPaths = paths.filter((item) => !batchPaths.includes(item));
    if (!newPaths.length) return;
    const next = [...batchPaths, ...newPaths];
    try {
      let id = batchId;
      if (id) await invoke("append_batch_items", { batchId: id, inputPaths: newPaths });
      else { id = await invoke<string>("enqueue_batch", { config: { inputPaths: newPaths, profile, outputs: preferences.outputs, cachePolicy: preferences.cachePolicy } }); setBatchId(id); }
      await loadBatch(id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return; }
    setBatchPaths(next);
    await inspectBatch(next);
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("menu-command", (event) => {
      switch (event.payload) {
        case "file-open":
          setView("workspace");
          setTab("single");
          void chooseSingle();
          break;
        case "file-add-batch":
          setView("workspace");
          setTab("batch");
          void addBatch();
          break;
        case "view-single-job":
          setView("workspace");
          setTab("single");
          break;
        case "view-batch":
          setView("workspace");
          setTab("batch");
          break;
        case "view-library":
          showLibrary();
          break;
        case "view-diagnostics":
          setView("diagnostics");
          break;
        case "view-settings":
          setView("settings");
          break;
        case "file-export":
          void exportActiveDocument();
          break;
      }
    }).then((stop) => { unlisten = stop; }).catch(() => { /* Browser preview has no native menu. */ });
    return () => unlisten?.();
  }, [activeDocument, batchId, batchPaths, preferences, profile]);

  const convert = async (paths: string[]) => {
    if (!paths.length) return;
    setRunning(true); setError(null);
    const jobId = await beginTask("conversion", tab === "batch" ? "Preparing the batch" : "Preparing the local converter", tab === "batch" ? batchPaths.length : 1);
    try {
      const data = tab === "batch" && batchId
        ? await invoke<ConversionResult>("run_batch", { batchId, jobId })
        : await invoke<ConversionResult>("run_conversion", { config: { inputPaths: paths, profile, outputs: preferences.outputs, cachePolicy: preferences.cachePolicy, jobId } });
      setResult(data);
      setSelectedBlockId(null);
      if (batchId) await loadBatch(batchId);
      await loadHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setRunning(false); finishTask(jobId); }
  };

  const setQueueItemState = async (path: string, state: "queued" | "paused" | "cancelled") => {
    const item = batchItems.find((candidate) => candidate.source_path === path);
    if (!item || !batchId) return;
    try {
      await invoke("set_batch_item_state", { itemId: item.id, state });
      await loadBatch(batchId);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const clearQueuedBatch = async () => {
    await Promise.all(batchItems.filter((item) => ["queued", "paused"].includes(item.status)).map((item) => invoke("set_batch_item_state", { itemId: item.id, state: "cancelled" })));
    if (batchId) await loadBatch(batchId);
    setBatchPreflight([]);
  };

  const openHistoricalJob = async (item: HistoryItem) => {
    const jobId = await beginTask("library", "Opening the selected local conversion");
    try {
      const payload = await invoke<ConversionResult>("get_job", { jobId: item.id });
      setResult(payload);
      setSinglePath(payload.results[0]?.source_path || null);
      setSelectedBlockId(null);
      setTab("single");
      setView("workspace");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { finishTask(jobId); }
  };

  const reviewBlock = async (blockId: string, action: "accept" | "edit" | "restore_candidate" | "ignore_warning", candidateIndex?: number, text?: string) => {
    if (!activeDocument) return;
    if (action === "edit") {
      const target = activeDocument.blocks.find((block) => block.id === blockId);
      if (!target) return;
      if (text === undefined) { setEditingBlock(target); return; }
    }
    try {
      const reply = await invoke<{ block?: BlockResult }>("apply_review", { review: { irPath: activeDocument.outputs.ir, blockId, reviewAction: action, text, candidateIndex } });
      if (reply.block) setResult((current) => current ? { ...current, results: current.results.map((document) => document.outputs.ir === activeDocument.outputs.ir ? { ...document, blocks: document.blocks.map((item) => item.id === blockId ? reply.block! : item) } : document) } : current);
      setNotice(action === "edit" ? "Edit recorded locally. The native candidate remains retained." : action === "restore_candidate" ? "Selected candidate applied locally. Its provenance remains retained." : "Review decision recorded locally.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const requestRepair = async (blockId: string, repairMode: "transcription" | "table" | "formula" = "transcription") => {
    if (!activeDocument) return;
    const jobId = await beginTask("repair", "Preparing the selected source region");
    try {
      const reply = await invoke<{ message: string; block?: BlockResult }>("request_repair", { irPath: activeDocument.outputs.ir, blockId, repairMode, jobId, enabledModelIds: preferences.enabledModelIds });
      if (reply.block) setResult((current) => current ? { ...current, results: current.results.map((document) => document.outputs.ir === activeDocument.outputs.ir ? { ...document, blocks: document.blocks.map((item) => item.id === blockId ? reply.block! : item) } : document) } : current);
      setNotice(reply.message);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { finishTask(jobId); }
  };

  const exportDocuments = async (documents: DocumentResult[]) => {
    if (!documents.length) return;
    let jobId: string | null = null;
    try {
      const destination = await open({ directory: true, multiple: false, title: "Export Philon conversion to…" });
      if (typeof destination !== "string") return;
      jobId = await beginTask("export", "Preparing export", documents.length);
      const exports = [] as Array<{ export_path: string; files: number }>;
      for (const [index, document] of documents.entries()) {
        setTaskProgress({ jobId, kind: "export", stage: "copying", message: `Copying ${basename(document.source_path)}`, percent: Math.round((index / documents.length) * 100), current: index + 1, total: documents.length, sourcePath: document.source_path });
        exports.push(await invoke<{ export_path: string; files: number }>("export_conversion", { irPath: document.outputs.ir, destinationDir: destination }));
      }
      const files = exports.reduce((total, item) => total + item.files, 0);
      setNotice(`Exported ${files} files from ${exports.length} conversion${exports.length === 1 ? "" : "s"} to ${destination}.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { if (jobId) finishTask(jobId); }
  };

  const exportActiveDocument = async () => exportDocuments(activeDocument ? [activeDocument] : []);

  const inspectEngine = async () => {
    try {
      const reply = await invoke<{ engine: string; local_only: boolean; review_actions: string[] }>("engine_health");
      setHealth(`${reply.engine} is ready. Local-only: ${reply.local_only ? "yes" : "no"}. ${reply.review_actions.length} review actions available.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
  };

  const inspectModels = async () => {
    const jobId = await beginTask("models", "Checking approved local model packs");
    try {
      const response = await invoke<{ packs: ModelPack[] }>("model_status");
      setModels(response.packs);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { finishTask(jobId); }
  };

  const showLibrary = () => {
    setView("library");
    void loadHistory(true);
  };

  const showModels = () => {
    setView("models");
    void inspectModels();
  };

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="app-header">
          <nav className="main-tabs" aria-label="Application areas">
            <button className={view === "workspace" ? "is-active" : ""} onClick={() => setView("workspace")} type="button">Workspace</button>
            <button className={view === "library" ? "is-active" : ""} onClick={showLibrary} type="button">Library{history.length ? <span>{history.length}</span> : null}</button>
            <button className={view === "models" ? "is-active" : ""} onClick={showModels} type="button">Models</button>
            <button className={view === "diagnostics" ? "is-active" : ""} onClick={() => setView("diagnostics")} type="button">Diagnostics</button>
            <button className={view === "settings" ? "is-active" : ""} onClick={() => setView("settings")} type="button">Settings</button>
          </nav>
          <div className="topbar-actions"><span className="system-status"><ShieldCheck size={15} weight="fill" /> Local only</span><button className="icon-button" type="button" title="About Philon" onClick={() => setSplashOpen(true)}><Info size={18} /></button></div>
        </header>
        {view === "workspace" && <div className="workspace-command-bar">
          <div className="job-tabs" role="tablist" aria-label="Job type"><button id="single-job-tab" role="tab" aria-controls="single-job-panel" aria-selected={tab === "single"} className={tab === "single" ? "is-active" : ""} onClick={() => setTab("single")} type="button"><FileArrowUp size={17} /> Single Job</button><button id="batch-tab" role="tab" aria-controls="batch-panel" aria-selected={tab === "batch"} className={tab === "batch" ? "is-active" : ""} onClick={() => setTab("batch")} type="button"><ListChecks size={17} /> Batch</button></div>
          {tab === "single" && <><button className="open-document-button" onClick={() => void chooseSingle()} type="button"><FolderOpen size={17} /> Open a document</button>{singlePath && <span className="selected-document-name" title={basename(singlePath)}>{basename(singlePath)}</span>}</>}
          <div className="command-actions"><ProfilePicker profile={profile} onChange={setProfile} />{activeDocument && tab === "single" && <button className="secondary-button" onClick={() => void exportActiveDocument()} type="button"><DownloadSimple size={17} /> Export…</button>}<button className="primary-button" onClick={() => void convert(tab === "single" ? (singlePath ? [singlePath] : []) : batchPaths)} disabled={(tab === "single" ? !singlePath : !batchPaths.length || batchPreflight.some((item) => item.status === "blocked")) || running} type="button">{running ? "Converting…" : <><Play size={17} weight="fill" /> Convert</>}</button></div>
        </div>}
        {error && <div className="error-banner"><WarningCircle size={19} weight="fill" /><span>{error}</span><button onClick={() => setError(null)} type="button" aria-label="Dismiss error"><X size={17} /></button></div>}
        {notice && <div className="notice-banner"><CheckCircle size={18} weight="fill" /><span>{notice}</span><button onClick={() => setNotice(null)} type="button" aria-label="Dismiss notice"><X size={17} /></button></div>}
        {taskProgress && <TaskProgressBar progress={taskProgress} />}
        {view === "workspace" && (tab === "single" ? (
          <section className="single-workspace" id="single-job-panel" role="tabpanel" aria-labelledby="single-job-tab" aria-label="Single Job">
            <div className="conversion-grid"><SourcePanel path={singlePath} document={activeDocument} selectedBlockId={selectedBlockId} onSelectPage={(pageNumber) => setSelectedBlockId(activeDocument?.blocks.find((block) => block.page === `page-${pageNumber}`)?.id || null)} /><OutputPanel document={activeDocument} selectedBlockId={selectedBlockId} onSelectBlock={setSelectedBlockId} /><EvidencePanel document={activeDocument} selectedBlockId={selectedBlockId} onSelectBlock={setSelectedBlockId} onReview={(blockId, action) => void reviewBlock(blockId, action)} onRestoreCandidate={(blockId, candidateIndex) => void reviewBlock(blockId, "restore_candidate", candidateIndex)} onRepair={(blockId, repairMode) => void requestRepair(blockId, repairMode)} /></div>
          </section>
        ) : (
          <section className="batch-workspace" aria-label="Batch">
            <div className="batch-toolbar"><span>{batchSummary.total ? `${batchSummary.completed} complete · ${batchSummary.waiting} waiting` : "No documents queued"}</span><button className="secondary-button" onClick={() => void addBatch()} type="button"><FolderOpen size={17} /> Add documents</button></div>
            <div className="batch-layout">
              <section className="queue-panel"><header><div><span className="eyebrow"><ListChecks size={14} weight="fill" /> Queue</span><h3>{batchSummary.total ? `${batchSummary.completed} of ${batchSummary.total} complete` : "No documents queued"}</h3></div><button className="text-button" type="button" onClick={() => void clearQueuedBatch()} disabled={!batchPaths.length}>Clear pending</button></header>{batchItems.length ? <div className="queue-list">{batchItems.map((queueItem) => { const path = queueItem.source_path; const inspected = batchPreflight.find((item) => item.source_path === path); const state = queueItem.status.replaceAll("_", " "); return <article key={queueItem.id}><FilePdf size={20} weight="duotone" /><div><strong>{basename(path)}</strong><span>{inspected?.status === "blocked" ? inspected.error : inspected?.preflight ? `${inspected.preflight.kind.toUpperCase()} · ${inspected.preflight.declared_page_count ?? "?"} page(s) · ${bytesLabel(inspected.preflight.bytes)} · ${state}` : state}{queueItem.status === "running" ? " — finishing this document before pausing or cancelling" : ""}</span></div><div className="queue-controls">{queueItem.status === "queued" && <button type="button" onClick={() => void setQueueItemState(path, "paused")}>Pause</button>}{queueItem.status === "running" && <button type="button" onClick={() => void setQueueItemState(path, "paused")}>Pause after</button>}{["paused", "cancelled", "failed"].includes(queueItem.status) && <button type="button" onClick={() => void setQueueItemState(path, "queued")}>Retry</button>}{!["completed", "completed_with_warnings"].includes(queueItem.status) && <button type="button" onClick={() => void setQueueItemState(path, "cancelled")} aria-label={`Remove ${basename(path)}`}><X size={16} /></button>}</div></article>; })}</div> : <button className="queue-empty" type="button" onClick={() => void addBatch()}><FileArrowUp size={28} /><span>Add PDFs or images to start a batch.</span></button>}</section>
              <section className="batch-report"><header><span className="eyebrow"><ClipboardText size={14} weight="fill" /> Latest batch</span><h3>{result ? `${result.results.length} completed, ${result.failures.length} failed` : "Awaiting a batch"}</h3></header>{result ? <><div className="batch-metrics"><div><strong>{result.results.reduce((sum, item) => sum + item.pages.length, 0)}</strong><span>Pages processed</span></div><div><strong>{result.results.reduce((sum, item) => sum + item.warnings.length, 0)}</strong><span>Warnings retained</span></div><div><strong>{result.results.filter((item) => item.cache_hit).length}</strong><span>Cache hits</span></div></div><div className="batch-export-row"><button className="secondary-button" type="button" onClick={() => void exportDocuments(result.results)} disabled={!result.results.length}><DownloadSimple size={16} /> Export completed conversions…</button></div><div className="export-list">{result.results.map((item) => <a href={`file://${item.outputs.evidence}`} key={item.id}><DownloadSimple size={16} /> {basename(item.source_path)} evidence report</a>)}</div></> : <div className="report-empty"><ShieldCheck size={28} weight="thin" /> Results will show source counts, cache use, and review warnings here.</div>}</section>
            </div>
          </section>
      ))}
        {view === "library" && <section className="secondary-workspace"><div className="secondary-heading"><div><span className="eyebrow"><Archive size={14} weight="fill" /> Library</span><h2>Recent local conversions</h2><p>History is stored in Philon’s local SQLite database on this Mac.</p></div><div className="library-actions">{libraryCleanPending ? <><button className="text-button" onClick={() => setLibraryCleanPending(false)} type="button">Cancel</button><button className="danger-button" onClick={() => void cleanLibrary()} type="button">Remove {history.length} job{history.length === 1 ? "" : "s"}</button></> : <button className="secondary-button" onClick={() => setLibraryCleanPending(true)} disabled={!history.length} type="button">Clean</button>}<button className="secondary-button" onClick={() => void loadHistory(true)} type="button"><ArrowClockwise size={16} /> Refresh</button></div></div>{history.length ? <><div className="history-list">{history.map((item) => <button className="history-item" key={item.id} onClick={() => void openHistoricalJob(item)} type="button"><div><strong>{item.documents} document{item.documents === 1 ? "" : "s"}</strong><span>{new Date(item.created_at).toLocaleString()} · {item.profile}</span></div><span className={item.warnings ? "history-warning" : "history-good"}>{item.warnings ? `${item.warnings} warnings` : "Verified"}</span></button>)}</div>{history.some((item) => item.warnings) && <div className="review-queue"><span className="eyebrow"><WarningCircle size={14} weight="fill" /> Cross-document review</span><p>{history.reduce((total, item) => total + item.warnings, 0)} warning{history.reduce((total, item) => total + item.warnings, 0) === 1 ? "" : "s"} remain across locally retained conversions. Select a job above to inspect its evidence.</p></div>}</> : <div className="secondary-empty"><Archive size={30} weight="thin" /> No local conversion history yet.</div>}</section>}
        {view === "models" && <section className="secondary-workspace models-workspace"><div className="secondary-heading"><div><span className="eyebrow"><MagicWand size={14} weight="fill" /> Models</span><h2>Local model access</h2><p>Optional models stay off until you enable them. Philon never downloads or uploads a model or your document.</p></div><button className="secondary-button" onClick={() => void inspectModels()} type="button"><ArrowClockwise size={16} /> Refresh</button></div>{models.length ? <div className="model-list">{models.map((pack) => { const enabled = preferences.enabledModelIds.includes(pack.id); const canEnable = Boolean(pack.approved && !pack.required && ["ready", "probe-required"].includes(pack.readiness || "")); const status = pack.readiness === "ready" ? "Ready locally" : pack.readiness === "incomplete" ? "Runtime incomplete" : pack.readiness === "probe-required" ? "Manual probe required" : pack.readiness === "blocked" ? "Blocked by policy" : pack.readiness === "not-found" ? "Not found locally" : pack.readiness === "unavailable" ? "Unavailable" : pack.available_locally ? "Available locally" : "Not installed"; return <article className="model-pack" key={pack.id}><ShieldCheck size={20} /><div><strong>{pack.id.replaceAll("-", " ")}</strong><span>{pack.role} · {pack.runtime}</span>{pack.diagnostics?.map((diagnostic) => <small key={diagnostic}>{diagnostic}</small>)}</div>{pack.required ? <b>Built in</b> : <button className={`model-toggle ${enabled ? "is-enabled" : ""}`} disabled={!canEnable} onClick={() => updatePreferences({ enabledModelIds: enabled ? preferences.enabledModelIds.filter((id) => id !== pack.id) : [...preferences.enabledModelIds, pack.id] })} type="button">{enabled ? "Enabled" : canEnable ? "Enable" : status}</button>}</article>; })}</div> : <div className="secondary-empty"><MagicWand size={30} weight="thin" /> Inspect local model availability.</div>}</section>}
        {view === "diagnostics" && <section className="secondary-workspace"><div className="secondary-heading"><div><span className="eyebrow"><Gauge size={14} weight="fill" /> Diagnostics</span><h2>Inspect the local runtime</h2><p>Diagnostics checks the authenticated Unix-socket engine only. It makes no network request.</p></div><button className="secondary-button" onClick={() => void inspectEngine()} type="button"><Play size={16} weight="fill" /> Run check</button></div><div className="diagnostic-card"><ShieldCheck size={24} weight="fill" /><div><strong>{health ? "Engine ready" : "Awaiting check"}</strong><p>{health || "Run a local check to verify the bundled engine bridge and available review actions."}</p></div></div>{activeDocument?.evidence_report && <div className="settings-list"><article><Gauge size={20} /><div><strong>Current conversion evidence</strong><span>{activeDocument.evidence_report.summary.pages} pages · {activeDocument.evidence_report.summary.blocks} blocks · {Math.round(activeDocument.evidence_report.summary.average_block_confidence * 100)}% average confidence</span></div><b>{activeDocument.evidence_report.summary.warnings ? `${activeDocument.evidence_report.summary.warnings} warnings` : "No warnings"}</b></article>{activeDocument.evidence_report.accessibility.findings.map((finding) => <article key={finding.rule}><ShieldCheck size={20} /><div><strong>{finding.rule.replaceAll("-", " ")}</strong><span>{finding.message}</span></div><b>{finding.status}</b></article>)}</div>}</section>}
        {view === "settings" && <section className="secondary-workspace settings-workspace"><div className="secondary-heading"><div><span className="eyebrow"><GearSix size={14} weight="fill" /> Settings</span><h2>Conversion preferences</h2><p>Choose the default quality and the files Philon creates for every conversion.</p></div><button className="secondary-button" type="button" onClick={() => { setPreferences(defaultPreferences); setProfile(defaultPreferences.defaultProfile); }}>Restore defaults</button></div><form className="preferences-form" onSubmit={(event) => event.preventDefault()}><section className="settings-section preference-rows"><label className="preference-row"><span><strong>Default profile</strong><small>Applied when you next open or start a conversion.</small></span><select value={preferences.defaultProfile} onChange={(event) => { const value = event.target.value as Profile; updatePreferences({ defaultProfile: value }); setProfile(value); }}>{profiles.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><label className="preference-row"><span><strong>Cache behavior</strong><small>Use prior local results, refresh them, or bypass the cache entirely.</small></span><select value={preferences.cachePolicy} onChange={(event) => updatePreferences({ cachePolicy: event.target.value as Preferences["cachePolicy"] })}><option value="use">Use cache</option><option value="refresh">Refresh cache</option><option value="bypass">Bypass cache</option></select></label></section><section className="settings-section output-preferences"><div className="settings-section-heading"><h3>Output formats</h3><p>Choose the files saved for new conversions.</p></div><div className="output-options">{outputChoices.map((output) => <label key={output}><input type="checkbox" checked={preferences.outputs.includes(output)} onChange={() => { const enabled = preferences.outputs.includes(output); const outputs = enabled ? preferences.outputs.filter((item) => item !== output) : [...preferences.outputs, output]; if (outputs.length) updatePreferences({ outputs }); }} /><span>{({ machine: "Machine-ready folder", markdown: "Clean reading Markdown", html: "Presentation HTML", ir: "Philon IR", marker_json: "Marker JSON (compatibility)", chunks: "RAG chunks", evidence: "Evidence report", table_csv: "Table CSV", assets: "Source images and previews", manifest: "Output manifest" } as Record<OutputChoice, string>)[output]}</span></label>)}</div></section><div className="settings-assurances"><article><CloudSlash size={20} /><div><strong>Local-only conversion</strong><span>Cloud providers are not configured.</span></div><b>Enabled</b></article><article><ShieldCheck size={20} /><div><strong>Evidence retention</strong><span>Warnings, routing decisions, alternatives, and reviews remain exportable.</span></div><b>Enabled</b></article><article><MagicWand size={20} /><div><strong>Manual model repair</strong><span>Only runs with an enabled local model for a selected source crop.</span></div><b>Local</b></article></div></form></section>}
      </section>
      {/* The maker's mark, at the foot of the window and on every view.
          Sits with the frame rather than over the content, which is why the
          workspace carries the room for it in its own bottom padding. */}
      <a className="makers-mark" href="https://tsevis.com" target="_blank" rel="noreferrer noopener" title="Made by Charis Tsevis — tsevis.com">
        <img src={makersMark} alt="Charis Tsevis" width={20} height={20} />
      </a>
      {splashOpen && <Splash onDismiss={() => { rememberSplashSeen(); setSplashOpen(false); }} />}
      {editingBlock && <ReviewEditor block={editingBlock} onCancel={() => setEditingBlock(null)} onSave={(text) => { void reviewBlock(editingBlock.id, "edit", undefined, text); setEditingBlock(null); }} />}
    </main>
  );
}

export default App;
