import {
  ChevronRight,
  Clipboard,
  Download,
  File,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Pencil,
  Plus,
  RefreshCcw,
  Search,
  Trash2,
  Upload,
  X
} from "lucide-react";
import type { DragEvent, MouseEvent, ReactElement } from "react";
import { useMemo, useRef, useState } from "react";
import { formatStorageBytes } from "../../shared/format";
import type {
  StorageBucket,
  StorageObject,
  StorageObjectMetadata,
  StoragePreviewResult,
  StorageTransferProgress
} from "../../shared/types";

type StorageWorkspaceProps = {
  bucket: string;
  buckets: StorageBucket[];
  canGoBack: boolean;
  canPageBack: boolean;
  canPageForward: boolean;
  filter: string;
  metadata: StorageObjectMetadata | null;
  objects: StorageObject[];
  prefix: string;
  preview: StoragePreviewResult | null;
  selectedObject: StorageObject | null;
  transferProgress: StorageTransferProgress | null;
  onBack: () => Promise<void>;
  onCopy: (object: StorageObject) => Promise<void>;
  onCreateFolder: () => Promise<void>;
  onDelete: (objects: StorageObject[]) => Promise<void>;
  onDownload: (object: StorageObject) => Promise<void>;
  onFilterChange: (value: string) => void;
  onMove: (object: StorageObject) => Promise<void>;
  onNextPage: () => Promise<void>;
  onOpenFolder: (prefix: string) => Promise<void>;
  onPreview: (object: StorageObject) => Promise<void>;
  onPreviousPage: () => Promise<void>;
  onRefresh: () => void;
  onSelect: (object: StorageObject) => void;
  onSelectBucket: (bucket: string) => Promise<void>;
  onUploadFiles: (files?: File[]) => Promise<void>;
  onUploadFolder: () => Promise<void>;
};

function objectId(object: StorageObject): string {
  return `${object.type}:${object.key}`;
}

export function StorageWorkspace({
  bucket,
  buckets,
  canGoBack,
  canPageBack,
  canPageForward,
  filter,
  metadata,
  objects,
  prefix,
  preview,
  selectedObject,
  transferProgress,
  onBack,
  onCopy,
  onCreateFolder,
  onDelete,
  onDownload,
  onFilterChange,
  onMove,
  onNextPage,
  onOpenFolder,
  onPreview,
  onPreviousPage,
  onRefresh,
  onSelect,
  onSelectBucket,
  onUploadFiles,
  onUploadFolder
}: StorageWorkspaceProps): ReactElement {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [dragDepth, setDragDepth] = useState(0);
  const anchorIdRef = useRef<string | null>(null);

  const selectedObjects = useMemo(
    () => objects.filter((object) => selectedIds.has(objectId(object))),
    [objects, selectedIds]
  );
  const singleSelection = selectedObjects.length === 1 ? selectedObjects[0] : selectedObject;
  const singleFile = singleSelection?.type === "file" ? singleSelection : null;
  const searching = filter.trim().length > 0;

  const handleRowClick = (object: StorageObject, event: MouseEvent<HTMLTableRowElement>): void => {
    const id = objectId(object);
    onSelect(object);

    if (event.shiftKey && anchorIdRef.current) {
      const anchorIndex = objects.findIndex((item) => objectId(item) === anchorIdRef.current);
      const targetIndex = objects.findIndex((item) => objectId(item) === id);
      if (anchorIndex !== -1 && targetIndex !== -1) {
        const [from, to] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
        setSelectedIds(new Set(objects.slice(from, to + 1).map(objectId)));
        return;
      }
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      anchorIdRef.current = id;
      return;
    }

    setSelectedIds(new Set([id]));
    anchorIdRef.current = id;
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragDepth(0);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void onUploadFiles(files);
    }
  };

  const clearFilter = (): void => {
    if (filter) {
      onFilterChange("");
    }
  };

  return (
    <div className="storage-workspace">
      <section className="storage-main">
        <div className="panel-toolbar">
          <div className="storage-pathbar">
            <button
              className="icon-button"
              type="button"
              title="Parent folder"
              onClick={() => void onBack()}
              disabled={!canGoBack || searching}
            >
              <ChevronRight className="rotate-180" size={16} />
            </button>
            {buckets.length > 0 ? (
              <select
                className="storage-bucket-select"
                value={bucket}
                title="Bucket"
                onChange={(event) => void onSelectBucket(event.target.value)}
              >
                {buckets.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            ) : (
              <strong title={bucket}>{bucket}</strong>
            )}
            <strong className="storage-prefix-label" title={prefix || undefined}>
              {prefix || ""}
            </strong>
            <div className="search-box storage-filter-box">
              <Search size={14} />
              <input
                value={filter}
                onChange={(event) => onFilterChange(event.target.value)}
                placeholder="Filter keys"
                aria-label="Filter keys"
              />
              {filter ? (
                <button className="icon-button" type="button" title="Clear filter" onClick={clearFilter}>
                  <X size={13} />
                </button>
              ) : null}
            </div>
          </div>
          <div className="storage-actions">
            {transferProgress ? (
              <span className="storage-transfer-status">
                {transferProgress.phase === "uploading"
                  ? `Uploading ${transferProgress.done}/${transferProgress.total}`
                  : transferProgress.phase === "done"
                    ? `Uploaded ${transferProgress.total}`
                    : "Upload failed"}
              </span>
            ) : null}
            <button className="icon-button" type="button" title="Refresh" onClick={onRefresh}>
              <RefreshCcw size={15} />
            </button>
            <button className="button secondary" type="button" onClick={() => void onUploadFiles()}>
              <Upload size={15} />
              Files
            </button>
            <button className="button secondary" type="button" onClick={() => void onUploadFolder()}>
              <FolderPlus size={15} />
              Folder
            </button>
            <button className="button secondary" type="button" onClick={() => void onCreateFolder()}>
              <Plus size={15} />
              New folder
            </button>
          </div>
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop target; keyboard users have the Upload button. */}
        <div
          className={`table-scroll storage-table-scroll ${dragDepth > 0 ? "drag-over" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragDepth((depth) => depth + 1);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragDepth((depth) => Math.max(0, depth - 1))}
          onDrop={handleDrop}
        >
          {dragDepth > 0 ? <div className="storage-drop-overlay">Drop files to upload</div> : null}
          <table className="data-grid storage-grid" aria-label="Bucket objects">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Last modified</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((object) => {
                const id = objectId(object);
                return (
                  <tr
                    className={`${selectedIds.has(id) ? "selected-row " : ""}${
                      selectedObject?.key === object.key ? "focused-row" : ""
                    }`}
                    key={id}
                    onClick={(event) => handleRowClick(object, event)}
                    onDoubleClick={() =>
                      object.type === "folder" ? void onOpenFolder(object.prefix) : void onPreview(object)
                    }
                  >
                    <td>
                      <span className="storage-name-cell">
                        {object.type === "folder" ? <Folder size={14} /> : <File size={14} />}
                        {object.name}
                      </span>
                    </td>
                    <td>{object.type}</td>
                    <td>{formatStorageBytes(object.size)}</td>
                    <td>{object.lastModified ? new Date(object.lastModified).toLocaleString() : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {objects.length === 0 ? (
            <p className="storage-empty">{searching ? "No objects match this filter." : "This folder is empty."}</p>
          ) : null}
        </div>

        <div className="insert-row">
          {searching ? (
            <span className="storage-search-note">Search results are not paginated.</span>
          ) : (
            <div className="insert-row-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void onPreviousPage()}
                disabled={!canPageBack}
              >
                Previous
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void onNextPage()}
                disabled={!canPageForward}
              >
                Next
              </button>
            </div>
          )}
          <div className="insert-row-actions">
            {selectedObjects.length > 1 ? (
              <span className="storage-selection-count">{selectedObjects.length} selected</span>
            ) : null}
            <button
              className="button secondary"
              type="button"
              onClick={() => singleFile && void onPreview(singleFile)}
              disabled={!singleFile}
            >
              <ImageIcon size={15} />
              Preview
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => singleFile && void onDownload(singleFile)}
              disabled={!singleFile}
            >
              <Download size={15} />
              Download
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => singleSelection && void onCopy(singleSelection)}
              disabled={!singleSelection}
            >
              <Clipboard size={15} />
              Copy
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => singleSelection && void onMove(singleSelection)}
              disabled={!singleSelection}
            >
              <Pencil size={15} />
              Rename
            </button>
            <button
              className="button danger"
              type="button"
              onClick={() =>
                void onDelete(selectedObjects.length > 0 ? selectedObjects : singleSelection ? [singleSelection] : [])
              }
              disabled={selectedObjects.length === 0 && !singleSelection}
            >
              <Trash2 size={15} />
              Delete{selectedObjects.length > 1 ? ` ${selectedObjects.length}` : ""}
            </button>
          </div>
        </div>
      </section>

      <aside className="storage-preview-panel">
        <header>
          <strong>{selectedObject?.name ?? "No object selected"}</strong>
          <span>{selectedObject?.key ?? "Select a file or folder"}</span>
        </header>
        {preview?.kind === "image" ? (
          <img className="storage-image-preview" alt={preview.key} src={preview.url} />
        ) : null}
        {/* biome-ignore lint/a11y/useMediaCaption: arbitrary user objects have no caption tracks. */}
        {preview?.kind === "video" ? <video className="storage-media-preview" controls src={preview.url} /> : null}
        {/* biome-ignore lint/a11y/useMediaCaption: arbitrary user objects have no caption tracks. */}
        {preview?.kind === "audio" ? <audio className="storage-media-preview" controls src={preview.url} /> : null}
        {preview?.kind === "pdf" ? (
          <iframe className="storage-media-preview" title={preview.key} src={preview.url} />
        ) : null}
        {preview?.kind === "text" ? <pre className="storage-text-preview">{preview.text}</pre> : null}
        {preview?.kind === "unsupported" ? <p className="storage-preview-message">{preview.reason}</p> : null}
        {metadata ? (
          <dl className="storage-metadata">
            <div>
              <dt>Content type</dt>
              <dd>{metadata.contentType ?? ""}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatStorageBytes(metadata.size)}</dd>
            </div>
            <div>
              <dt>Last modified</dt>
              <dd>{metadata.lastModified ? new Date(metadata.lastModified).toLocaleString() : ""}</dd>
            </div>
            <div>
              <dt>ETag</dt>
              <dd>{metadata.etag ?? ""}</dd>
            </div>
          </dl>
        ) : null}
      </aside>
    </div>
  );
}
