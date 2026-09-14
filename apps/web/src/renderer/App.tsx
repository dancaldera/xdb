import { sql } from "@codemirror/lang-sql";
import CodeMirror from "@uiw/react-codemirror";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Archive,
  Atom,
  Binary,
  Bird,
  Bot,
  Box,
  Boxes,
  Braces,
  Bug,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  CircuitBoard,
  Clipboard,
  Clock,
  Cloud,
  CloudCog,
  CloudDownload,
  CloudUpload,
  Code,
  Coffee,
  Container,
  Cpu,
  Crown,
  Database,
  DatabaseBackup,
  Dice5,
  Disc,
  Dna,
  Download,
  Droplet,
  Eye,
  EyeOff,
  ExternalLink,
  Feather,
  File,
  FileClock,
  FileDown,
  FileUp,
  Fingerprint,
  FlaskConical,
  Folder,
  FolderGit2,
  FolderPlus,
  FolderTree,
  Gem,
  Ghost,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  GripVertical,
  Hammer,
  HardDrive,
  Hexagon,
  Hourglass,
  Image as ImageIcon,
  KeyRound,
  Layers,
  Leaf,
  Loader2,
  ListChecks,
  Lock,
  Magnet,
  MemoryStick,
  Microscope,
  Minus,
  Monitor,
  Moon,
  MousePointerClick,
  Network,
  Octagon,
  Orbit,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Play,
  Plus,
  Printer,
  Package,
  Puzzle,
  Radio,
  Rabbit,
  RefreshCcw,
  RefreshCw,
  Rocket,
  Rss,
  Save,
  Satellite,
  SatelliteDish,
  Scan,
  Search,
  Server,
  ServerCog,
  Settings,
  Shield,
  Sigma,
  Skull,
  Smartphone,
  SlidersHorizontal,
  Snail,
  Snowflake,
  Sprout,
  Star,
  Sun,
  SunMedium,
  Table2,
  Tag,
  Telescope,
  Terminal,
  TestTube,
  TestTubes,
  ToggleLeft,
  Trash2,
  TreePalm,
  TriangleAlert,
  Trophy,
  Turtle,
  Unplug,
  Upload,
  Usb,
  Warehouse,
  Webhook,
  Wifi,
  Wind,
  Wrench,
  X,
  Zap,
  type LucideIcon
} from "lucide-react";
import type { CSSProperties, DragEvent, FormEvent, MouseEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ModalBackdrop } from "./components/ModalBackdrop";
import { Toaster, toast } from "sonner";
import mysqlIconUrl from "./assets/database-icons/mysql.svg";
import postgresqlIconUrl from "./assets/database-icons/postgresql.svg";
import sqliteIconUrl from "./assets/database-icons/sqlite.svg";
import cloudflareD1IconUrl from "./assets/database-icons/cloudflare-d1.svg";
import s3CompatibleIconUrl from "./assets/database-icons/s3-compatible.svg";
import tursoIconUrl from "./assets/database-icons/turso.svg";
import { buildConnectionString, normalizeConnectionInput } from "../shared/connections";
import { version as appVersion } from "../../package.json";
import type {
  AppSettings,
  ConnectionGroup,
  ConnectionGroupInput,
  ConnectionInput,
  ConnectionProfile,
  ConnectionRuntimeStatus,
  ConnectionEngine,
  ConnectionIconMode,
  ConnectionTestResult,
  DatabaseBackupProgress,
  DatabaseRestoreProgress,
  DatabaseEngine,
  DatabaseInfo,
  DatabaseObject,
  QueryExecutionResult,
  QueryHistoryItem,
  SavedSqlQuery,
  SslMode,
  StorageObject,
  StorageObjectMetadata,
  StoragePreviewResult,
  TableColumn,
  TableDataResult,
  TableFilterInput,
  TableFilterOperator,
  TableFilterRule,
  TableSortDirection,
  TableSortInput,
  TableStructure,
  ThemePreference
} from "../shared/types";
import type { ClipboardRowFormat } from "./lib/format";
import { formatCell, formatRowsForClipboard, parseCellInput } from "./lib/format";
import {
  connectionGroupSectionKey,
  useConnectionPickerLayout,
  type ConnectionDropTarget,
  type GroupDropTarget
} from "./lib/connection-picker-layout";

const DEFAULT_SQL = "select current_database(), current_user, now();";
const SQL_DRAFT_SAVE_DELAY_MS = 500;
const PAGE_SIZE = 100;
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 520;
const DEFAULT_OBJECTS_SIDEBAR_WIDTH = 252;
const MIN_OBJECTS_SIDEBAR_WIDTH = 216;
const MAX_OBJECTS_SIDEBAR_WIDTH = 360;
const EMPTY_DRAFT_ROW: Record<string, unknown> = Object.freeze({});
const OBJECTS_COLLAPSED_STORAGE_KEY = "xdb:layout:objects-collapsed";
const OBJECTS_SIDEBAR_WIDTH_STORAGE_KEY = "xdb:layout:objects-sidebar-width";
const SIDEBAR_TOGGLE_KEY = "b";
const DEFAULT_APP_SETTINGS: AppSettings = { theme: "system" };
const COPY_ROW_FORMATS: { format: ClipboardRowFormat; label: string }[] = [
  { format: "plain", label: "Plain text" },
  { format: "json", label: "JSON" },
  { format: "html", label: "HTML table" },
  { format: "markdown", label: "Markdown table" },
  { format: "csv", label: "CSV" },
  { format: "csvWithHeader", label: "CSV with header" },
  { format: "insert", label: "INSERT statement" }
];
const EMPTY_TABLE_FILTERS: TableFilterInput = { rules: [] };
const TABLE_FILTER_OPERATORS: { operator: TableFilterOperator; label: string; requiresValue: boolean }[] = [
  { operator: "equals", label: "=", requiresValue: true },
  { operator: "notEquals", label: "<>", requiresValue: true },
  { operator: "lessThan", label: "<", requiresValue: true },
  { operator: "lessThanOrEqual", label: "<=", requiresValue: true },
  { operator: "greaterThan", label: ">", requiresValue: true },
  { operator: "greaterThanOrEqual", label: ">=", requiresValue: true },
  { operator: "contains", label: "Contains", requiresValue: true },
  { operator: "notContains", label: "Not contains", requiresValue: true },
  { operator: "startsWith", label: "Has prefix", requiresValue: true },
  { operator: "notStartsWith", label: "Not prefix", requiresValue: true },
  { operator: "endsWith", label: "Has suffix", requiresValue: true },
  { operator: "notEndsWith", label: "Not suffix", requiresValue: true },
  { operator: "isNull", label: "IS NULL", requiresValue: false },
  { operator: "isNotNull", label: "IS NOT NULL", requiresValue: false },
  { operator: "in", label: "IN", requiresValue: true },
  { operator: "notIn", label: "NOT IN", requiresValue: true }
];
const ANY_COLUMN_FILTER_OPERATORS = new Set<TableFilterOperator>([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "notStartsWith",
  "endsWith",
  "notEndsWith",
  "isNull",
  "isNotNull",
  "in",
  "notIn"
]);
const VALUELESS_FILTER_OPERATORS = new Set<TableFilterOperator>(["isNull", "isNotNull"]);
const SORT_DIRECTIONS: TableSortDirection[] = ["desc", "asc"];

type MainTab = "data" | "query" | "structure" | "saved" | "history";
type ResolvedTheme = "light" | "dark";
type RunTaskOptions = {
  errorToast?: false | { title?: string; description?: string };
};
type DraftRows = Record<string, Record<string, unknown>>;
type StagedRow = Record<string, string>;
type DraftRowUpdate = {
  row: Record<string, unknown>;
  rowKey: string;
};
type RowEditor = {
  row: Record<string, unknown>;
  rowKey: string;
};
type DeleteRowConfirmation = {
  rows: Record<string, unknown>[];
};
type DatabaseDropConfirmation = {
  profileId: string;
  databaseName: string;
};
type ClipboardRow = {
  row: Record<string, unknown>;
  rowKey: string;
};
type EditingCell = {
  rowKey: string;
  columnName: string;
};
type ColumnLayout = {
  order: string[];
  widths: Record<string, number>;
};
type ColumnDropTarget = {
  columnName: string;
  side: "before" | "after";
};
type ObjectTabId = string;
type ObjectTabDropTarget = {
  tabId: ObjectTabId;
  side: "before" | "after";
};
type ObjectTab = {
  id: ObjectTabId;
  object: DatabaseObject;
  pinned: boolean;
  mode: MainTab;
  page: number;
  tableData: TableDataResult | null;
  structure: TableStructure | null;
  draftRows: DraftRows;
  stagedRow: StagedRow | null;
  draftFilters: TableFilterInput;
  appliedFilters: TableFilterInput;
  tableSort: TableSortInput | null;
  filtersVisible: boolean;
  filterTableKey: string;
};
type CloseObjectTabConfirmation = {
  tabId: ObjectTabId;
};
type ConnectionSessionSnapshot = {
  objectTabs: ObjectTab[];
  activeObjectTabId: ObjectTabId | null;
  sqlText: string;
  activeMode: MainTab;
};
type ConnectionGroupSection = {
  group: ConnectionGroup | null;
  connections: ConnectionProfile[];
};
type ConnectionContextMenu = {
  profileId: string;
  x: number;
  y: number;
};
type DatabaseTask = {
  profileId: string;
  type: "backup" | "restore";
};
type RowContextMenu =
  | {
      type: "existing";
      row: Record<string, unknown>;
      rowKey: string;
      x: number;
      y: number;
    }
  | {
      type: "staged";
      x: number;
      y: number;
    };
type CellContextMenu =
  | {
      type: "existing";
      row: Record<string, unknown>;
      rowKey: string;
      column: TableColumn;
      value: unknown;
      x: number;
      y: number;
    }
  | {
      type: "staged";
      column: TableColumn;
      value: string;
      x: number;
      y: number;
    };

const CONNECTION_COLORS = [
  { name: "Blue", value: "#3b82f6" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Emerald", value: "#10b981" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Rose", value: "#f43f5e" },
  { name: "Slate", value: "#64748b" }
] as const;
const DEFAULT_CONNECTION_COLOR = CONNECTION_COLORS[0].value;
const DEFAULT_CONNECTION_GROUP_COLOR = CONNECTION_COLORS[1].value;

const EMPTY_CONNECTION: ConnectionInput = {
  kind: "database",
  engine: "postgresql",
  name: "",
  connectionUrl: "",
  host: "localhost",
  port: 5432,
  database: "postgres",
  user: "postgres",
  password: "",
  sslMode: "prefer",
  color: DEFAULT_CONNECTION_COLOR,
  savePassword: false,
  detectJsonColumns: false
};
const ENGINE_OPTIONS: { engine: ConnectionEngine; label: string }[] = [
  { engine: "postgresql", label: "PostgreSQL" },
  { engine: "mysql", label: "MySQL" },
  { engine: "sqlite", label: "SQLite" },
  { engine: "turso", label: "Turso" },
  { engine: "cloudflare-d1", label: "Cloudflare D1" },
  { engine: "s3-compatible", label: "S3 Compatible" }
];
const ENGINE_ICON_URLS: Record<ConnectionEngine, string> = {
  postgresql: postgresqlIconUrl,
  mysql: mysqlIconUrl,
  sqlite: sqliteIconUrl,
  turso: tursoIconUrl,
  "cloudflare-d1": cloudflareD1IconUrl,
  "s3-compatible": s3CompatibleIconUrl
};
const CONNECTION_ICONS: Record<string, LucideIcon> = {
  // Databases & data
  database: Database,
  databaseBackup: DatabaseBackup,
  archive: Archive,
  box: Box,
  package: Package,
  boxes: Boxes,
  container: Container,
  warehouse: Warehouse,
  layers: Layers,
  folderTree: FolderTree,
  folderGit: FolderGit2,
  binary: Binary,
  disc: Disc,
  memoryStick: MemoryStick,
  // Compute & infra
  server: Server,
  serverCog: ServerCog,
  cpu: Cpu,
  circuitBoard: CircuitBoard,
  hardDrive: HardDrive,
  network: Network,
  cloud: Cloud,
  cloudCog: CloudCog,
  cloudDownload: CloudDownload,
  cloudUpload: CloudUpload,
  globe: Globe,
  satellite: Satellite,
  satelliteDish: SatelliteDish,
  radio: Radio,
  wifi: Wifi,
  rss: Rss,
  usb: Usb,
  webhook: Webhook,
  printer: Printer,
  smartphone: Smartphone,
  // Dev & science
  terminal: Terminal,
  code: Code,
  gitBranch: GitBranch,
  gitCommit: GitCommitHorizontal,
  refreshCw: RefreshCw,
  flaskConical: FlaskConical,
  testTube: TestTube,
  testTubes: TestTubes,
  microscope: Microscope,
  telescope: Telescope,
  atom: Atom,
  dna: Dna,
  magnet: Magnet,
  scan: Scan,
  // Ops & status
  activity: Activity,
  clock: Clock,
  hourglass: Hourglass,
  shield: Shield,
  lock: Lock,
  key: KeyRound,
  fingerprint: Fingerprint,
  triangleAlert: TriangleAlert,
  octagon: Octagon,
  sigma: Sigma,
  // Misc / decorative
  star: Star,
  zap: Zap,
  hexagon: Hexagon,
  crown: Crown,
  trophy: Trophy,
  gem: Gem,
  tag: Tag,
  rocket: Rocket,
  orbit: Orbit,
  puzzle: Puzzle,
  dice: Dice5,
  bot: Bot,
  hammer: Hammer,
  wrench: Wrench,
  coffee: Coffee,
  leaf: Leaf,
  sprout: Sprout,
  feather: Feather,
  droplet: Droplet,
  snowflake: Snowflake,
  wind: Wind,
  sunMedium: SunMedium,
  treePalm: TreePalm,
  ghost: Ghost,
  skull: Skull,
  bug: Bug,
  bird: Bird,
  rabbit: Rabbit,
  turtle: Turtle,
  snail: Snail,
  mousePointer: MousePointerClick
};
const ICON_MODE_OPTIONS: { mode: ConnectionIconMode; label: string }[] = [
  { mode: "default", label: "Default" },
  { mode: "icon", label: "Icon" },
  { mode: "emoji", label: "Emoji" },
  { mode: "image", label: "Image" }
];
const EMOJI_CHOICES: string[] = [
  // Faces
  "😀",
  "😁",
  "😂",
  "🤣",
  "😊",
  "😍",
  "😎",
  "🤩",
  "🤔",
  "😐",
  "😶",
  "😏",
  "😴",
  "😜",
  "🤪",
  "🥳",
  "😇",
  "🙂",
  "😉",
  "😌",
  "🤗",
  "🤭",
  "🫡",
  "🤓",
  "😺",
  "😸",
  "😻",
  "🙀",
  "🐶",
  "🐱",
  "🐭",
  "🐹",
  // Storage & data
  "🗄️",
  "🗃️",
  "💾",
  "🪣",
  "🧱",
  "📦",
  "📚",
  "🔖",
  // Infrastructure
  "🖥️",
  "☁️",
  "🔌",
  "⚡",
  "🔋",
  "⚙️",
  "🔧",
  "🛠️",
  // Symbols
  "⭐",
  "🔥",
  "💎",
  "🎯",
  "🚀",
  "🌐",
  "🏷️",
  "📌",
  // Security & misc
  "🔒",
  "🔑",
  "🛡️",
  "🧪",
  "📊",
  "📈",
  "🎨",
  "🏆",
  // Nature & animals
  "✅",
  "🌟",
  "🪐",
  "🌵",
  "🌊",
  "🐉",
  "🦊",
  "🐱",
  "🐢",
  "🐙",
  "🦄",
  "🐳",
  "🐬",
  "🦉",
  "🦜",
  "🐝"
];

function defaultConnectionForEngine(engine: ConnectionEngine): ConnectionInput {
  const remoteSqlite = engine === "turso" || engine === "cloudflare-d1";
  const storage = engine === "s3-compatible";

  return {
    ...EMPTY_CONNECTION,
    kind: storage ? "storage" : "database",
    engine,
    host: engine === "mysql" ? "localhost" : engine === "sqlite" || remoteSqlite || storage ? "" : "localhost",
    port: engine === "mysql" ? 3306 : engine === "sqlite" || remoteSqlite || storage ? 0 : 5432,
    database: engine === "mysql" || engine === "sqlite" || remoteSqlite || storage ? "" : "postgres",
    filePath: undefined,
    endpoint: undefined,
    accountId: undefined,
    databaseId: undefined,
    bucket: undefined,
    region: storage ? "us-east-1" : undefined,
    accessKeyId: undefined,
    sessionToken: undefined,
    rootPrefix: undefined,
    forcePathStyle: storage ? true : undefined,
    user: engine === "mysql" ? "root" : engine === "sqlite" || remoteSqlite || storage ? "" : "postgres",
    password: "",
    sslMode: engine === "sqlite" ? "disable" : remoteSqlite || storage ? "require" : "prefer",
    savePassword: false
  };
}

export function App(): ReactElement {
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [connectionGroups, setConnectionGroups] = useState<ConnectionGroup[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [connectionsSliderOpen, setConnectionsSliderOpen] = useState(false);
  const [openedProfileIds, setOpenedProfileIds] = useState<string[]>([]);
  const [draggedTileId, setDraggedTileId] = useState<string | null>(null);
  const [tileDropTarget, setTileDropTarget] = useState<{ id: string; side: "before" | "after" } | null>(null);
  const [status, setStatus] = useState<ConnectionRuntimeStatus | null>(null);
  const [objects, setObjects] = useState<DatabaseObject[]>([]);
  const [storageObjects, setStorageObjects] = useState<StorageObject[]>([]);
  const [storagePrefix, setStoragePrefix] = useState("");
  const [storagePreviousTokens, setStoragePreviousTokens] = useState<Array<string | null>>([]);
  const [storageContinuationToken, setStorageContinuationToken] = useState<string | null>(null);
  const [storageNextToken, setStorageNextToken] = useState<string | null>(null);
  const [selectedStorageObject, setSelectedStorageObject] = useState<StorageObject | null>(null);
  const [storageMetadata, setStorageMetadata] = useState<StorageObjectMetadata | null>(null);
  const [storagePreview, setStoragePreview] = useState<StoragePreviewResult | null>(null);
  const [objectTabs, setObjectTabs] = useState<ObjectTab[]>([]);
  const [activeObjectTabId, setActiveObjectTabId] = useState<ObjectTabId | null>(null);
  const connectionSessionsRef = useRef<Record<string, ConnectionSessionSnapshot>>({});
  const [closeObjectTabConfirmation, setCloseObjectTabConfirmation] = useState<CloseObjectTabConfirmation | null>(null);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [savedQueries, setSavedQueries] = useState<SavedSqlQuery[]>([]);
  const [activeSavedQueryId, setActiveSavedQueryId] = useState<string | null>(null);
  const [savedQueryName, setSavedQueryName] = useState("");
  const [queryResult, setQueryResult] = useState<QueryExecutionResult | null>(null);
  const [sqlText, setSqlText] = useState(DEFAULT_SQL);
  const [activeMode, setActiveModeState] = useState<MainTab>("query");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitial, setModalInitial] = useState<ConnectionProfile | null>(null);
  const [databaseListProfileId, setDatabaseListProfileId] = useState<string | null>(null);
  const [databaseList, setDatabaseList] = useState<DatabaseInfo[] | null>(null);
  const [databaseListLoading, setDatabaseListLoading] = useState(false);
  const [databaseDropConfirmation, setDatabaseDropConfirmation] = useState<DatabaseDropConfirmation | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_APP_SETTINGS);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveThemePreference(DEFAULT_APP_SETTINGS.theme)
  );
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupModalInitial, setGroupModalInitial] = useState<ConnectionGroup | null>(null);
  const [contextMenu, setContextMenu] = useState<ConnectionContextMenu | null>(null);
  const [connectionPickerOpen, setConnectionPickerOpen] = useState(false);
  const [connectionExportModalOpen, setConnectionExportModalOpen] = useState(false);
  const [connectingProfileId, setConnectingProfileId] = useState<string | null>(null);
  const [objectsCollapsed, setObjectsCollapsed] = useState(() =>
    readStoredBoolean(OBJECTS_COLLAPSED_STORAGE_KEY, false)
  );
  const [objectsSidebarWidth, setObjectsSidebarWidth] = useState<number | null>(() =>
    readStoredNumber(OBJECTS_SIDEBAR_WIDTH_STORAGE_KEY)
  );
  const [password, setPassword] = useState("");
  const [search, setSearch] = useState("");
  const [databaseTask, setDatabaseTask] = useState<DatabaseTask | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingObjectTabIds = useRef<Set<ObjectTabId>>(new Set());
  const backupToastIds = useRef<Map<string, string | number>>(new Map());
  const activeBackupTaskIdRef = useRef<string | null>(null);
  const restoreToastIds = useRef<Map<string, string | number>>(new Map());
  const sqlDraftSaveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );
  const connectingProfile = useMemo(
    () => profiles.find((profile) => profile.id === connectingProfileId) ?? selectedProfile,
    [connectingProfileId, profiles, selectedProfile]
  );
  const connected = Boolean(status?.connected && status.profileId === selectedProfileId);
  const connectedStorage = connected && status?.engine === "s3-compatible";
  const connectedDatabase = connected && status?.engine !== "s3-compatible";
  const connecting = Boolean(connectingProfileId);
  const activeObjectTab = useMemo(
    () => objectTabs.find((item) => item.id === activeObjectTabId) ?? null,
    [activeObjectTabId, objectTabs]
  );
  const selectedObject = activeObjectTab?.object ?? null;
  const activeTableData = activeObjectTab?.tableData ?? null;
  const activeStructure = activeObjectTab?.structure ?? null;
  const activeDraftRows = activeObjectTab?.draftRows ?? {};
  const activeStagedRow = activeObjectTab?.stagedRow ?? null;
  const activeDraftFilters = activeObjectTab?.draftFilters ?? EMPTY_TABLE_FILTERS;
  const activeFilters = activeObjectTab?.appliedFilters ?? EMPTY_TABLE_FILTERS;
  const activeTableSort = activeObjectTab?.tableSort ?? null;
  const activeFiltersVisible = Boolean(activeObjectTab?.filtersVisible);
  const openObjectTabIds = useMemo(() => new Set(objectTabs.map((item) => item.id)), [objectTabs]);
  const previewObjectTabId = objectTabs.find((item) => !item.pinned)?.id ?? null;

  const runTask = useCallback(async (task: () => Promise<void>, options: RunTaskOptions = {}): Promise<boolean> => {
    setLoading(true);

    try {
      await task();
      return true;
    } catch (taskError) {
      if (options.errorToast !== false) {
        const message = errorMessage(taskError);
        toast.error(options.errorToast?.title ?? "Action failed", {
          description: options.errorToast?.description ?? message
        });
      }
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    return window.xdb.onBackupProgress((progress: DatabaseBackupProgress) => {
      const toastId = backupToastIds.current.get(progress.taskId);
      if (!toastId) {
        return;
      }

      const description = progress.message ?? backupProgressDescription(progress);
      if (progress.phase === "failed") {
        toast.error("Backup failed", { id: toastId, description });
        backupToastIds.current.delete(progress.taskId);
        return;
      }

      if (progress.phase === "cancelled") {
        toast.dismiss(toastId);
        backupToastIds.current.delete(progress.taskId);
        return;
      }

      if (progress.phase === "done") {
        toast.loading("Creating backup...", { id: toastId, description });
        return;
      }

      toast.loading("Creating backup...", {
        id: toastId,
        description,
        action: {
          label: "Cancel",
          onClick: () => {
            void window.xdb.cancelBackup(progress.taskId);
          }
        }
      });
    });
  }, []);

  useEffect(() => {
    return window.xdb.onRestoreProgress((progress: DatabaseRestoreProgress) => {
      const toastId = restoreToastIds.current.get(progress.taskId);
      if (!toastId) {
        return;
      }

      const description = progress.message ?? restoreProgressDescription(progress);
      if (progress.phase === "failed") {
        toast.error("Restore failed", { id: toastId, description });
        restoreToastIds.current.delete(progress.taskId);
        return;
      }

      if (progress.phase === "cancelled") {
        toast.dismiss(toastId);
        restoreToastIds.current.delete(progress.taskId);
        return;
      }

      if (progress.phase === "done") {
        toast.loading("Restoring database...", { id: toastId, description });
        return;
      }

      toast.loading("Restoring database...", {
        id: toastId,
        description,
        action: {
          label: "Cancel",
          onClick: () => {
            void window.xdb.cancelRestore(progress.taskId);
          }
        }
      });
    });
  }, []);

  const loadConnections = useCallback(async () => {
    const [items, groups] = await Promise.all([window.xdb.listConnections(), window.xdb.listConnectionGroups()]);

    setProfiles(items);
    setConnectionGroups(groups);
    setConnectionsLoaded(true);
    setSelectedProfileId((current) =>
      current && items.some((item) => item.id === current) ? current : items[0]?.id || ""
    );
  }, []);

  const loadObjects = useCallback(
    async (profileId = selectedProfileId) => {
      if (!profileId) {
        return;
      }

      const databaseObjects = await window.xdb.listObjects(profileId);
      setObjects(databaseObjects);
    },
    [selectedProfileId]
  );

  const loadStorageObjects = useCallback(
    async (
      profileId = selectedProfileId,
      prefix = storagePrefix,
      continuationToken: string | null = storageContinuationToken
    ) => {
      if (!profileId) {
        return;
      }

      const result = await window.xdb.listStorageObjects({
        profileId,
        prefix,
        continuationToken: continuationToken ?? undefined,
        pageSize: PAGE_SIZE
      });
      setStorageObjects(result.objects);
      setStoragePrefix(result.prefix);
      setStorageNextToken(result.nextContinuationToken);
      setSelectedStorageObject(null);
      setStorageMetadata(null);
      setStoragePreview(null);
    },
    [selectedProfileId, storageContinuationToken, storagePrefix]
  );

  const loadHistory = useCallback(
    async (profileId = selectedProfileId) => {
      const items = await window.xdb.getHistory(profileId || undefined);
      setHistory(items);
    },
    [selectedProfileId]
  );

  const loadSavedQueries = useCallback(
    async (profileId = selectedProfileId) => {
      if (!profileId) {
        setSavedQueries([]);
        setActiveSavedQueryId(null);
        setSavedQueryName("");
        return;
      }

      const queries = await window.xdb.listSavedQueries(profileId);
      setSavedQueries(queries);
      setActiveSavedQueryId((current) => (current && queries.some((query) => query.id === current) ? current : null));
    },
    [selectedProfileId]
  );

  const loadSqlDraft = useCallback(async (profileId: string, engine: DatabaseEngine): Promise<string> => {
    const draft = await window.xdb.getSqlDraft(profileId);
    return draft?.sql || defaultSqlForEngine(engine);
  }, []);

  const saveSqlDraftSoon = useCallback((profileId: string, sql: string): void => {
    if (sqlDraftSaveTimeout.current) {
      clearTimeout(sqlDraftSaveTimeout.current);
    }

    sqlDraftSaveTimeout.current = setTimeout(() => {
      void window.xdb.saveSqlDraft(profileId, sql);
      sqlDraftSaveTimeout.current = null;
    }, SQL_DRAFT_SAVE_DELAY_MS);
  }, []);

  const updateSqlText = useCallback(
    (nextSql: string, options: { savedQueryId?: string | null; persistDraft?: boolean } = {}): void => {
      setSqlText(nextSql);
      if ("savedQueryId" in options) {
        setActiveSavedQueryId(options.savedQueryId ?? null);
        if (!options.savedQueryId) {
          setSavedQueryName("");
        }
      }

      if (options.persistDraft !== false && selectedProfileId && connectedDatabase) {
        saveSqlDraftSoon(selectedProfileId, nextSql);
      }
    },
    [connectedDatabase, saveSqlDraftSoon, selectedProfileId]
  );

  const loadSettings = useCallback(async () => {
    setAppSettings(await window.xdb.getSettings());
  }, []);

  const saveThemePreference = useCallback(
    async (theme: ThemePreference): Promise<void> => {
      setAppSettings((current) => ({ ...current, theme }));

      try {
        const nextSettings = await window.xdb.saveSettings({ theme });
        setAppSettings(nextSettings);
      } catch (settingsError) {
        toast.error("Settings could not be saved", {
          description: errorMessage(settingsError)
        });
        void loadSettings();
      }
    },
    [loadSettings]
  );

  const updateObjectTab = useCallback((tabId: ObjectTabId, updater: (tab: ObjectTab) => ObjectTab): void => {
    setObjectTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }, []);

  const loadObjectTabData = useCallback(
    async (
      targetTab: ObjectTab,
      targetPage = targetTab.page,
      targetFilters = targetTab.appliedFilters,
      targetSort = targetTab.tableSort
    ) => {
      if (!selectedProfileId) {
        return;
      }

      const [data, nextStructure] = await Promise.all([
        window.xdb.getTableData(
          selectedProfileId,
          targetTab.object.schema,
          targetTab.object.name,
          targetPage,
          PAGE_SIZE,
          targetFilters,
          targetSort
        ),
        window.xdb.getTableStructure(selectedProfileId, targetTab.object.schema, targetTab.object.name)
      ]);

      updateObjectTab(targetTab.id, (tab) => ({
        ...tab,
        page: targetPage,
        tableData: data,
        structure: nextStructure,
        draftRows: {},
        stagedRow: null
      }));
      await loadHistory(selectedProfileId);
    },
    [loadHistory, selectedProfileId, updateObjectTab]
  );

  const loadObjectTabDataWithToast = useCallback(
    async (
      targetTab: ObjectTab,
      targetPage = targetTab.page,
      targetFilters = targetTab.appliedFilters,
      targetSort = targetTab.tableSort
    ) => {
      if (loadingObjectTabIds.current.has(targetTab.id)) {
        return;
      }

      loadingObjectTabIds.current.add(targetTab.id);
      const tableName = objectDisplayName(targetTab.object);
      const toastId = toast.loading("Loading table...", { description: tableName });
      const loaded = await runTask(() => loadObjectTabData(targetTab, targetPage, targetFilters, targetSort), {
        errorToast: false
      });
      loadingObjectTabIds.current.delete(targetTab.id);

      if (loaded) {
        toast.success("Table loaded", { id: toastId, description: tableName });
      } else {
        toast.error("Table load failed", { id: toastId, description: tableName });
      }
    },
    [loadObjectTabData, runTask]
  );

  useEffect(() => {
    void runTask(async () => {
      await Promise.all([loadConnections(), loadSettings()]);
    });
  }, [loadConnections, loadSettings, runTask]);

  useEffect(
    () => () => {
      if (sqlDraftSaveTimeout.current) {
        clearTimeout(sqlDraftSaveTimeout.current);
      }
    },
    []
  );

  useEffect(() => {
    const applyResolvedTheme = (): void => {
      const nextTheme = resolveThemePreference(appSettings.theme);
      setResolvedTheme(nextTheme);
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
    };

    applyResolvedTheme();

    if (appSettings.theme !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", applyResolvedTheme);
    return () => media.removeEventListener("change", applyResolvedTheme);
  }, [appSettings.theme]);

  useEffect(() => {
    if (connectedDatabase) {
      void runTask(async () => {
        await Promise.all([loadObjects(), loadHistory()]);
      });
    }
  }, [connectedDatabase, loadHistory, loadObjects, runTask]);

  useEffect(() => {
    if (
      connectedDatabase &&
      activeObjectTab &&
      !activeObjectTab.tableData &&
      !activeObjectTab.structure &&
      !loadingObjectTabIds.current.has(activeObjectTab.id)
    ) {
      void runTask(() => loadObjectTabData(activeObjectTab));
    }
  }, [activeObjectTab, connectedDatabase, loadObjectTabData, runTask]);

  useEffect(() => {
    writeStoredBoolean(OBJECTS_COLLAPSED_STORAGE_KEY, objectsCollapsed);
  }, [objectsCollapsed]);

  useEffect(() => {
    if (objectsSidebarWidth !== null) {
      writeStoredNumber(OBJECTS_SIDEBAR_WIDTH_STORAGE_KEY, objectsSidebarWidth);
    }
  }, [objectsSidebarWidth]);

  useEffect(() => {
    const handleSidebarToggleKeyDown = (event: KeyboardEvent): void => {
      if (!isSidebarToggleShortcut(event)) {
        return;
      }

      event.preventDefault();
      if (connectedDatabase) {
        setObjectsCollapsed((current) => !current);
      }
    };

    window.addEventListener("keydown", handleSidebarToggleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleSidebarToggleKeyDown);
    };
  }, [connectedDatabase]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeContextMenu = (): void => setContextMenu(null);
    const closeContextMenuOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeContextMenuOnEscape);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenuOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!connectionPickerOpen) {
      return;
    }

    const closeConnectionPicker = (): void => setConnectionPickerOpen(false);
    const closeConnectionPickerOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeConnectionPicker();
      }
    };

    window.addEventListener("click", closeConnectionPicker);
    window.addEventListener("keydown", closeConnectionPickerOnEscape);

    return () => {
      window.removeEventListener("click", closeConnectionPicker);
      window.removeEventListener("keydown", closeConnectionPickerOnEscape);
    };
  }, [connectionPickerOpen]);

  const saveProfile = async (input: ConnectionInput): Promise<void> => {
    await runTask(async () => {
      const saved = await window.xdb.saveConnection(input);
      if (connected && input.id === selectedProfileId) {
        await window.xdb.disconnect(input.id);
        clearConnectedState();
      }
      await loadConnections();
      setSelectedProfileId(saved.id);
      setModalOpen(false);
      setModalInitial(null);
    });
  };

  const testConnection = async (input: ConnectionInput): Promise<ConnectionTestResult> => {
    const result = await window.xdb.testConnection(input);
    await loadConnections();
    return result;
  };

  const saveConnectionGroup = async (input: ConnectionGroupInput): Promise<void> => {
    await runTask(async () => {
      await window.xdb.saveConnectionGroup(input);
      await loadConnections();
      setGroupModalOpen(false);
      setGroupModalInitial(null);
    });
  };

  const deleteConnectionGroup = async (groupId: string): Promise<void> => {
    await runTask(async () => {
      await window.xdb.deleteConnectionGroup(groupId);
      await loadConnections();
    });
  };

  const openNewConnection = (): void => {
    setModalInitial(null);
    setModalOpen(true);
  };

  const openNewGroup = (): void => {
    setGroupModalInitial(null);
    setGroupModalOpen(true);
  };

  const openEditGroup = (group: ConnectionGroup): void => {
    setGroupModalInitial(group);
    setGroupModalOpen(true);
  };

  const openEditConnection = async (profileId = selectedProfileId): Promise<void> => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    await runTask(async () => {
      setSelectedProfileId(profileId);
      const fullProfile = await window.xdb.getConnection(profileId);
      setModalInitial(fullProfile ?? profile);
      setModalOpen(true);
    });
  };

  const closeConnectionModal = (): void => {
    setModalOpen(false);
    setModalInitial(null);
  };

  const clearConnectedState = (): void => {
    setStatus(null);
    setObjects([]);
    setStorageObjects([]);
    setStoragePrefix("");
    setStoragePreviousTokens([]);
    setStorageContinuationToken(null);
    setStorageNextToken(null);
    setSelectedStorageObject(null);
    setStorageMetadata(null);
    setStoragePreview(null);
    setObjectTabs([]);
    setActiveObjectTabId(null);
    setCloseObjectTabConfirmation(null);
    setQueryResult(null);
    setSavedQueries([]);
    setActiveSavedQueryId(null);
    setSavedQueryName("");
    setActiveModeState("query");
  };

  const connect = async (profileId = selectedProfileId): Promise<void> => {
    if (!profileId) {
      openNewConnection();
      return;
    }

    setSelectedProfileId(profileId);

    if (status?.connected && status.profileId === profileId) {
      return;
    }

    // Snapshot the workspace of the connection we are leaving so it can be restored later.
    if (status?.connected && status.profileId) {
      connectionSessionsRef.current[status.profileId] = {
        objectTabs,
        activeObjectTabId,
        sqlText,
        activeMode: activeMode
      };
    }

    setConnectingProfileId(profileId);

    await runTask(async () => {
      if (status?.connected && status.profileId !== profileId) {
        await window.xdb.disconnect(status.profileId);
        clearConnectedState();
      }

      const inlinePassword = profileId === selectedProfileId ? password || undefined : undefined;
      const nextStatus = await window.xdb.connect(profileId, inlinePassword);
      setStatus(nextStatus);
      if (nextStatus.connected) {
        setOpenedProfileIds((current) => (current.includes(profileId) ? current : [...current, profileId]));
      }
      setPassword("");
      if (nextStatus.engine === "s3-compatible") {
        setSavedQueries([]);
        setActiveSavedQueryId(null);
        setSavedQueryName("");
        setStoragePrefix("");
        setStoragePreviousTokens([]);
        setStorageContinuationToken(null);
        await loadStorageObjects(profileId, "", null);
      } else {
        const restoredSession = connectionSessionsRef.current[profileId];
        const draftSql = await loadSqlDraft(profileId, nextStatus.engine);
        setSqlText(restoredSession ? restoredSession.sqlText : draftSql);
        setActiveSavedQueryId(null);
        setSavedQueryName("");
        await Promise.all([loadObjects(profileId), loadHistory(profileId), loadSavedQueries(profileId)]);
        // Restore this connection's saved workspace: opened tables, fetched data, filters, etc.
        if (restoredSession) {
          setObjectTabs(restoredSession.objectTabs);
          setActiveObjectTabId(restoredSession.activeObjectTabId);
          setActiveModeState(restoredSession.activeMode);
        }
      }
    });

    setConnectingProfileId(null);
  };

  const disconnect = async (): Promise<void> => {
    if (!selectedProfileId) {
      return;
    }

    // Keep the workspace snapshot so reconnecting later restores opened tables and data.
    connectionSessionsRef.current[selectedProfileId] = {
      objectTabs,
      activeObjectTabId,
      sqlText,
      activeMode: activeMode
    };

    await runTask(async () => {
      await window.xdb.disconnect(selectedProfileId);
      clearConnectedState();
    });
  };

  const removeOpenedProfile = async (profileId: string): Promise<void> => {
    setOpenedProfileIds((current) => current.filter((id) => id !== profileId));
    // Closing it from the list also tears down its live session and wipes its saved workspace.
    if (status?.connected && status.profileId === profileId) {
      await disconnect();
    }
    delete connectionSessionsRef.current[profileId];
  };

  const reorderOpenedProfiles = (sourceId: string, targetId: string, side: "before" | "after"): void => {
    if (sourceId === targetId) {
      return;
    }
    setOpenedProfileIds((current) => {
      const next = current.filter((id) => id !== sourceId);
      const index = next.indexOf(targetId);
      if (index < 0) {
        return current;
      }
      next.splice(side === "before" ? index : index + 1, 0, sourceId);
      return next;
    });
  };

  const deleteProfile = async (profileId: string): Promise<void> => {
    await runTask(async () => {
      await window.xdb.deleteConnection(profileId);
      await loadConnections();
      if (profileId === selectedProfileId) {
        setSelectedProfileId("");
        setStatus(null);
      }
    });
  };

  const copyConnectionString = async (profileId: string): Promise<void> => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    await runTask(async () => {
      const fullProfile = await window.xdb.getConnection(profileId);
      await writeClipboardText(
        buildConnectionString({
          ...(fullProfile ?? profile),
          password:
            profileId === selectedProfileId
              ? password || fullProfile?.password || profile.password
              : fullProfile?.password
        })
      );
      toast.success("Connection string copied");
    });
  };

  const duplicateConnection = async (profileId: string): Promise<void> => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    await runTask(async () => {
      const fullProfile = await window.xdb.getConnection(profileId);
      const source = fullProfile ?? profile;
      const duplicate = duplicateConnectionInput(source, profiles);
      const saved = await window.xdb.saveConnection(duplicate);
      await loadConnections();
      setSelectedProfileId(saved.id);
      toast.success("Connection duplicated", {
        description: saved.name || profileDisplayTarget(saved)
      });
    });
  };

  const openDatabaseList = async (profileId: string): Promise<void> => {
    setDatabaseListProfileId(profileId);
    setDatabaseList(null);
    setDatabaseListLoading(true);
    await runTask(async () => {
      if (!(status?.connected && status.profileId === profileId)) {
        await connect(profileId);
      }
      setDatabaseList(await window.xdb.listDatabases(profileId));
    });
    setDatabaseListLoading(false);
  };

  const closeDatabaseList = (): void => {
    setDatabaseListProfileId(null);
    setDatabaseList(null);
    setDatabaseDropConfirmation(null);
  };

  const createDatabase = async (profileId: string, databaseName: string): Promise<boolean> => {
    setDatabaseListLoading(true);
    const created = await runTask(
      async () => {
        await window.xdb.createDatabase(profileId, databaseName);
        setDatabaseList(await window.xdb.listDatabases(profileId));
        toast.success("Database created", { description: databaseName });
      },
      { errorToast: { title: "Could not create database" } }
    );
    setDatabaseListLoading(false);
    return created;
  };

  const dropDatabase = async (profileId: string, databaseName: string): Promise<void> => {
    setDatabaseDropConfirmation(null);
    setDatabaseListLoading(true);
    await runTask(
      async () => {
        await window.xdb.dropDatabase(profileId, databaseName);
        setDatabaseList(await window.xdb.listDatabases(profileId));
        toast.success("Database dropped", { description: databaseName });
      },
      { errorToast: { title: "Could not drop database" } }
    );
    setDatabaseListLoading(false);
  };

  const createConnectionForDatabase = async (profileId: string, dbName: string): Promise<void> => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    await runTask(async () => {
      const fullProfile = await window.xdb.getConnection(profileId);
      const source = fullProfile ?? profile;
      const input: ConnectionInput = {
        ...duplicateConnectionInput(source, profiles),
        database: dbName,
        name: nextDuplicateConnectionName(dbName, profiles)
      };
      const saved = await window.xdb.saveConnection(input);
      await loadConnections();
      setSelectedProfileId(saved.id);
      toast.success("Connection created", {
        description: saved.name || profileDisplayTarget(saved)
      });
    });
  };

  const exportConnections = async (includeSecrets: boolean): Promise<void> => {
    setConnectionExportModalOpen(false);
    setConnectionPickerOpen(false);

    await runTask(async () => {
      const result = await window.xdb.exportConnections(includeSecrets);
      if (!result) {
        return;
      }

      toast.success(result.includeSecrets ? "Complete connection backup exported" : "Connections exported", {
        description: `${result.connections} connections and ${result.groups} groups saved to ${result.filePath}`,
        duration: 8000
      });
    });
  };

  const importConnections = async (): Promise<void> => {
    setConnectionPickerOpen(false);

    await runTask(async () => {
      const result = await window.xdb.importConnections();
      if (!result) {
        return;
      }

      await loadConnections();
      toast.success("Connections imported", {
        description: `${result.connections} connections and ${result.groups} groups imported`
      });
    });
  };

  const backupDatabase = async (profileId: string): Promise<void> => {
    const inlinePassword = profileId === selectedProfileId ? password || undefined : undefined;
    const taskId = crypto.randomUUID();
    setSelectedProfileId(profileId);
    setDatabaseTask({ profileId, type: "backup" });
    setLoading(true);
    activeBackupTaskIdRef.current = taskId;
    const toastId = toast.loading("Creating backup...", {
      description: "Choose where to save the backup.",
      action: {
        label: "Cancel",
        onClick: () => {
          void window.xdb.cancelBackup(taskId);
        }
      }
    });
    backupToastIds.current.set(taskId, toastId);

    try {
      const result = await window.xdb.backupDatabase(profileId, inlinePassword, taskId);
      if (result) {
        toast.success("Backup saved", {
          id: toastId,
          description: result.filePath,
          duration: 8000
        });
      } else {
        toast.dismiss(toastId);
      }
    } catch (backupError) {
      toast.error("Backup failed", {
        id: toastId,
        description: errorMessage(backupError)
      });
    } finally {
      backupToastIds.current.delete(taskId);
      if (activeBackupTaskIdRef.current === taskId) {
        activeBackupTaskIdRef.current = null;
      }
      setLoading(false);
      setDatabaseTask(null);
    }
  };

  const restoreDatabase = async (profileId: string): Promise<void> => {
    const inlinePassword = profileId === selectedProfileId ? password || undefined : undefined;
    const restoringConnectedProfile = Boolean(status?.connected && status.profileId === profileId);
    const taskId = crypto.randomUUID();
    setSelectedProfileId(profileId);
    setDatabaseTask({ profileId, type: "restore" });
    setLoading(true);
    const toastId = toast.loading("Restoring database...", {
      description: "Choose a backup file to restore.",
      action: {
        label: "Cancel",
        onClick: () => {
          void window.xdb.cancelRestore(taskId);
        }
      }
    });
    restoreToastIds.current.set(taskId, toastId);

    try {
      const result = await window.xdb.restoreDatabase(profileId, inlinePassword, taskId);
      if (result) {
        toast.success("Database restored", {
          id: toastId,
          description: result.filePath,
          duration: 8000
        });
        if (restoringConnectedProfile) {
          setObjectTabs([]);
          setActiveObjectTabId(null);
          setCloseObjectTabConfirmation(null);
          setQueryResult(null);
          setActiveModeState("query");
          await Promise.all([loadObjects(profileId), loadHistory(profileId)]);
        }
      } else {
        toast.dismiss(toastId);
      }
    } catch (restoreError) {
      toast.error("Restore failed", {
        id: toastId,
        description: errorMessage(restoreError)
      });
    } finally {
      restoreToastIds.current.delete(taskId);
      setLoading(false);
      setDatabaseTask(null);
    }
  };

  const selectStorageObject = async (object: StorageObject): Promise<void> => {
    setSelectedStorageObject(object);
    setStoragePreview(null);
    if (object.type === "folder") {
      setStorageMetadata(null);
      return;
    }

    await runTask(async () => {
      setStorageMetadata(await window.xdb.getStorageObjectMetadata(selectedProfileId, object.key));
    });
  };

  const openStorageFolder = async (prefix: string): Promise<void> => {
    setStoragePreviousTokens([]);
    setStorageContinuationToken(null);
    await runTask(() => loadStorageObjects(selectedProfileId, prefix, null));
  };

  const openParentStorageFolder = async (): Promise<void> => {
    const parent = parentStoragePrefix(storagePrefix);
    await openStorageFolder(parent);
  };

  const loadNextStoragePage = async (): Promise<void> => {
    if (!storageNextToken) {
      return;
    }
    setStoragePreviousTokens((current) => [...current, storageContinuationToken]);
    setStorageContinuationToken(storageNextToken);
    await runTask(() => loadStorageObjects(selectedProfileId, storagePrefix, storageNextToken));
  };

  const loadPreviousStoragePage = async (): Promise<void> => {
    const nextStack = storagePreviousTokens.slice(0, -1);
    const previousToken = storagePreviousTokens.at(-1) ?? null;
    setStoragePreviousTokens(nextStack);
    setStorageContinuationToken(previousToken);
    await runTask(() => loadStorageObjects(selectedProfileId, storagePrefix, previousToken));
  };

  const previewSelectedStorageObject = async (): Promise<void> => {
    if (selectedStorageObject?.type !== "file") {
      return;
    }

    await runTask(async () => {
      setStoragePreview(await window.xdb.previewStorageObject(selectedProfileId, selectedStorageObject.key));
    });
  };

  const downloadSelectedStorageObject = async (): Promise<void> => {
    if (selectedStorageObject?.type !== "file") {
      return;
    }

    await runTask(async () => {
      const result = await window.xdb.downloadStorageObject(selectedProfileId, selectedStorageObject.key);
      if (result) {
        toast.success("File downloaded", { description: result.filePath });
      }
    });
  };

  const uploadStorageFiles = async (): Promise<void> => {
    await runTask(async () => {
      const result = await window.xdb.uploadStorageFiles(selectedProfileId, storagePrefix);
      if (result) {
        toast.success("Files uploaded", { description: `${result.uploaded} uploaded, ${result.skipped} skipped` });
        await loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken);
      }
    });
  };

  const uploadStorageFolder = async (): Promise<void> => {
    await runTask(async () => {
      const result = await window.xdb.uploadStorageFolder(selectedProfileId, storagePrefix);
      if (result) {
        toast.success("Folder uploaded", { description: `${result.uploaded} uploaded` });
        await loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken);
      }
    });
  };

  const createStorageFolder = async (): Promise<void> => {
    const name = window.prompt("Folder name");
    if (!name) {
      return;
    }

    await runTask(async () => {
      await window.xdb.createStorageFolder(selectedProfileId, storagePrefix, name);
      await loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken);
    });
  };

  const copySelectedStorageObject = async (): Promise<void> => {
    if (selectedStorageObject?.type !== "file") {
      return;
    }

    const destinationKey = window.prompt("Copy to key", selectedStorageObject.key);
    if (!destinationKey || destinationKey === selectedStorageObject.key) {
      return;
    }

    await runTask(async () => {
      await window.xdb.copyStorageObject({
        profileId: selectedProfileId,
        sourceKey: selectedStorageObject.key,
        destinationKey
      });
      await loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken);
    });
  };

  const moveSelectedStorageObject = async (): Promise<void> => {
    if (selectedStorageObject?.type !== "file") {
      return;
    }

    const destinationKey = window.prompt("Move to key", selectedStorageObject.key);
    if (!destinationKey || destinationKey === selectedStorageObject.key) {
      return;
    }

    await runTask(async () => {
      await window.xdb.moveStorageObject({
        profileId: selectedProfileId,
        sourceKey: selectedStorageObject.key,
        destinationKey
      });
      await loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken);
    });
  };

  const deleteSelectedStorageObject = async (): Promise<void> => {
    if (!selectedStorageObject) {
      return;
    }

    if (!window.confirm(`Delete ${selectedStorageObject.key}?`)) {
      return;
    }

    await runTask(async () => {
      await window.xdb.deleteStorageObjects({ profileId: selectedProfileId, keys: [selectedStorageObject.key] });
      await loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken);
    });
  };

  const openConnectionContextMenu = (profileId: string, event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (profileId !== selectedProfileId) {
      setPassword("");
    }
    setSelectedProfileId(profileId);
    setContextMenu({
      profileId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 170)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 224))
    });
  };

  const focusObjectTab = (tabId: ObjectTabId): void => {
    const targetTab = objectTabs.find((item) => item.id === tabId);
    if (!targetTab) {
      return;
    }

    setActiveObjectTabId(tabId);
    setActiveModeState(targetTab.mode);
  };

  const openObject = (object: DatabaseObject, pinned: boolean): void => {
    if (!selectedProfileId) {
      return;
    }

    const tabId = objectTabId(selectedProfileId, object);
    const existingTab = objectTabs.find((item) => item.id === tabId);
    if (existingTab) {
      const nextTab = { ...existingTab, pinned: existingTab.pinned || pinned };
      setObjectTabs((current) => current.map((item) => (item.id === tabId ? nextTab : item)));
      setActiveObjectTabId(tabId);
      setActiveModeState(nextTab.mode);
      if (!nextTab.tableData && !nextTab.structure) {
        void loadObjectTabDataWithToast(nextTab);
      }
      return;
    }

    const nextTab = createObjectTab(selectedProfileId, object, pinned);
    const previewTab = objectTabs.find((item) => !item.pinned);
    const nextTabs =
      previewTab && !isObjectTabDirty(previewTab)
        ? objectTabs.map((item) => (item.id === previewTab.id ? nextTab : item))
        : [
            ...objectTabs.map((item) => (!item.pinned && isObjectTabDirty(item) ? { ...item, pinned: true } : item)),
            nextTab
          ];

    setObjectTabs(nextTabs);
    setActiveObjectTabId(nextTab.id);
    setActiveModeState(nextTab.mode);
    void loadObjectTabDataWithToast(nextTab);
  };

  const openFilteredObjectTab = (object: DatabaseObject, column: string, value: unknown): void => {
    if (!selectedProfileId) {
      return;
    }

    const nextTab = createFilteredObjectTab(selectedProfileId, object, column, value);
    setObjectTabs((current) => [...current, nextTab]);
    setActiveObjectTabId(nextTab.id);
    setActiveModeState("data");
    void loadObjectTabDataWithToast(nextTab, 1, nextTab.appliedFilters, nextTab.tableSort);
  };

  const openObjectPreview = (object: DatabaseObject): void => {
    openObject(object, false);
  };

  const pinObjectTab = (object: DatabaseObject): void => {
    openObject(object, true);
  };

  const pinOpenObjectTab = (tabId: ObjectTabId): void => {
    setObjectTabs((current) => current.map((item) => (item.id === tabId ? { ...item, pinned: true } : item)));
  };

  const closeObjectTabNow = (tabId: ObjectTabId): void => {
    const closingIndex = objectTabs.findIndex((item) => item.id === tabId);
    if (closingIndex === -1) {
      return;
    }

    const nextTabs = objectTabs.filter((item) => item.id !== tabId);
    setObjectTabs(nextTabs);
    setCloseObjectTabConfirmation(null);

    if (activeObjectTabId !== tabId) {
      return;
    }

    const nextActiveTab = nextTabs[Math.max(0, closingIndex - 1)] ?? nextTabs[0] ?? null;
    setActiveObjectTabId(nextActiveTab?.id ?? null);
    setActiveModeState(nextActiveTab?.mode ?? "query");
  };

  const closeObjectTab = (tabId: ObjectTabId): void => {
    const targetTab = objectTabs.find((item) => item.id === tabId);
    if (!targetTab) {
      return;
    }

    if (isObjectTabDirty(targetTab)) {
      setCloseObjectTabConfirmation({ tabId });
      return;
    }

    closeObjectTabNow(tabId);
  };

  const reorderObjectTab = (sourceTabId: ObjectTabId, targetTabId: ObjectTabId, side: "before" | "after"): void => {
    setObjectTabs((current) => reorderObjectTabs(current, sourceTabId, targetTabId, side));
  };

  const setMode = (nextMode: MainTab): void => {
    if ((nextMode === "data" || nextMode === "structure") && !activeObjectTab) {
      return;
    }

    setActiveModeState(nextMode);

    if (activeObjectTab && (nextMode === "data" || nextMode === "structure")) {
      updateObjectTab(activeObjectTab.id, (tab) => ({ ...tab, mode: nextMode }));
    }
  };

  const startObjectsSidebarResize = (event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    const sidebar = event.currentTarget.closest(".object-browser");
    const startWidth = clampObjectsSidebarWidth(
      sidebar?.getBoundingClientRect().width ?? DEFAULT_OBJECTS_SIDEBAR_WIDTH
    );
    const startX = event.clientX;

    setObjectsCollapsed(false);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent): void => {
      setObjectsSidebarWidth(clampObjectsSidebarWidth(startWidth + moveEvent.clientX - startX));
    };
    const handlePointerUp = (): void => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const resetObjectsSidebarWidth = (): void => {
    setObjectsSidebarWidth(null);
    removeStoredValue(OBJECTS_SIDEBAR_WIDTH_STORAGE_KEY);
  };

  const executeSql = async (): Promise<void> => {
    if (!selectedProfileId) {
      return;
    }

    await runTask(async () => {
      const result = await window.xdb.executeQuery(selectedProfileId, sqlText);
      setQueryResult(result);
      setMode("query");
      await loadHistory(selectedProfileId);
      if (activeObjectTab) {
        await loadObjectTabData(activeObjectTab);
      }
    });
  };

  const saveCurrentSqlQuery = async (forceNew = false): Promise<void> => {
    if (!selectedProfileId || !connectedDatabase) {
      return;
    }

    const sql = sqlText.trim();
    if (!sql) {
      toast.error("Query cannot be empty");
      return;
    }

    const existing =
      !forceNew && activeSavedQueryId ? savedQueries.find((query) => query.id === activeSavedQueryId) : null;
    const suggestedName = existing?.name ?? savedQueryNameFromSql(sql);
    const name = savedQueryName.trim() || suggestedName;

    if (!name) {
      return;
    }

    await runTask(async () => {
      const saved = await window.xdb.saveSavedQuery({
        id: existing?.id,
        profileId: selectedProfileId,
        name,
        sql
      });
      await Promise.all([loadSavedQueries(selectedProfileId), window.xdb.saveSqlDraft(selectedProfileId, sql)]);
      setActiveSavedQueryId(saved.id);
      setSavedQueryName(saved.name);
      toast.success(existing ? "Saved query updated" : "Query saved", {
        description: saved.name
      });
    });
  };

  const loadSavedQueryIntoEditor = async (query: SavedSqlQuery): Promise<void> => {
    if (!selectedProfileId || query.profileId !== selectedProfileId) {
      return;
    }

    updateSqlText(query.sql, { savedQueryId: query.id });
    setSavedQueryName(query.name);
    setMode("query");
  };

  const deleteSavedSqlQuery = async (query: SavedSqlQuery): Promise<void> => {
    await runTask(async () => {
      await window.xdb.deleteSavedQuery(query.id);
      if (activeSavedQueryId === query.id) {
        setActiveSavedQueryId(null);
        setSavedQueryName("");
      }
      await loadSavedQueries(query.profileId);
      toast.success("Saved query deleted", { description: query.name });
    });
  };

  const refresh = async (): Promise<void> => {
    const toastId = toast.loading(connected ? "Reloading connection..." : "Reloading connections...");

    const reloaded = await runTask(
      async () => {
        if (!connected) {
          await loadConnections();
          return;
        }

        if (connectedStorage) {
          await Promise.all([
            loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken),
            loadConnections()
          ]);
          return;
        }

        await Promise.all([loadObjects(), loadHistory(), loadConnections()]);
        if (activeObjectTab) {
          await loadObjectTabData(activeObjectTab);
        }
      },
      { errorToast: false }
    );

    if (reloaded) {
      toast.success(connected ? "Connection reloaded" : "Connections reloaded", { id: toastId });
    } else {
      toast.error("Reload failed", { id: toastId });
    }
  };

  const refreshObjectTab = async (tab: ObjectTab): Promise<void> => {
    const tableName = objectDisplayName(tab.object);
    const toastId = toast.loading("Reloading table...", { description: tableName });
    const reloaded = await runTask(() => loadObjectTabData(tab), { errorToast: false });

    if (reloaded) {
      toast.success("Table reloaded", { id: toastId, description: tableName });
    } else {
      toast.error("Table reload failed", { id: toastId, description: tableName });
    }
  };

  const applyCellChange = (rowKey: string, column: string, value: string): void => {
    if (!activeObjectTab?.tableData) {
      return;
    }

    const data = activeObjectTab.tableData;
    const originalRow = data.rows.find((row, index) => rowKeyFor(data.primaryKeys, row, index) === rowKey);
    const parsedValue = parseCellInput(value);

    updateObjectTab(activeObjectTab.id, (tab) => {
      const current = tab.draftRows;
      const nextRow = { ...(current[rowKey] ?? {}) };

      if (originalRow && isCellValueUnchanged(originalRow[column], parsedValue, value)) {
        delete nextRow[column];
      } else {
        nextRow[column] = parsedValue;
      }

      const nextDrafts = { ...current };
      if (Object.keys(nextRow).length === 0) {
        delete nextDrafts[rowKey];
      } else {
        nextDrafts[rowKey] = nextRow;
      }

      return {
        ...tab,
        draftRows: nextDrafts
      };
    });
  };

  const applyStagedRowChange = (column: string, value: string): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      stagedRow: {
        ...(tab.stagedRow ?? {}),
        [column]: value
      }
    }));
  };

  const startStagedRow = (): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      stagedRow: tab.stagedRow ?? {}
    }));
  };

  const resetTableChanges = (): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      draftRows: {},
      stagedRow: null
    }));
  };

  const cancelStagedRow = (): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      stagedRow: null
    }));
  };

  const addFilterRule = (): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      draftFilters: {
        rules: [...tab.draftFilters.rules, createDefaultFilterRule()]
      }
    }));
  };

  const updateFilterRule = (ruleId: string, updates: Partial<TableFilterRule>): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      draftFilters: {
        rules: tab.draftFilters.rules.map((rule) => (rule.id === ruleId ? { ...rule, ...updates } : rule))
      }
    }));
  };

  const removeFilterRule = (ruleId: string): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      draftFilters: {
        rules: tab.draftFilters.rules.filter((rule) => rule.id !== ruleId)
      }
    }));
  };

  const toggleFilters = (): void => {
    if (!activeObjectTab) {
      return;
    }

    updateObjectTab(activeObjectTab.id, (tab) => ({
      ...tab,
      draftFilters:
        !tab.filtersVisible && tab.draftFilters.rules.length === 0
          ? { rules: [createDefaultFilterRule()] }
          : tab.draftFilters,
      filtersVisible: !tab.filtersVisible
    }));
  };

  const applyFilters = (): void => {
    if (!activeObjectTab) {
      return;
    }

    const normalizedFilters = normalizeTableFilters(activeObjectTab.draftFilters);
    const nextTab = {
      ...activeObjectTab,
      appliedFilters: normalizedFilters,
      filterTableKey: activeObjectTab.id,
      page: 1
    };
    updateObjectTab(activeObjectTab.id, () => nextTab);
    void runTask(() => loadObjectTabData(nextTab, 1, normalizedFilters, nextTab.tableSort));
  };

  const clearFilters = (): void => {
    if (!activeObjectTab) {
      return;
    }

    const nextTab = {
      ...activeObjectTab,
      draftFilters: EMPTY_TABLE_FILTERS,
      appliedFilters: EMPTY_TABLE_FILTERS,
      filterTableKey: activeObjectTab.id,
      page: 1
    };
    updateObjectTab(activeObjectTab.id, () => nextTab);
    void runTask(() => loadObjectTabData(nextTab, 1, EMPTY_TABLE_FILTERS, nextTab.tableSort));
  };

  const changeTableSort = (nextSort: TableSortInput | null): void => {
    if (!activeObjectTab) {
      return;
    }

    const nextTab = {
      ...activeObjectTab,
      tableSort: nextSort,
      page: 1
    };
    updateObjectTab(activeObjectTab.id, () => nextTab);
    void runTask(() => loadObjectTabData(nextTab, 1, activeObjectTab.appliedFilters, nextSort));
  };

  const setActiveTabPage = (nextPage: number): void => {
    if (!activeObjectTab) {
      return;
    }

    const nextTab = {
      ...activeObjectTab,
      page: nextPage
    };
    updateObjectTab(activeObjectTab.id, () => nextTab);
    void runTask(() => loadObjectTabData(nextTab, nextPage, activeObjectTab.appliedFilters, activeObjectTab.tableSort));
  };

  const deleteRows = async (rows: Record<string, unknown>[]): Promise<void> => {
    if (!activeObjectTab?.tableData || !selectedProfileId) {
      return;
    }

    const targetTab = activeObjectTab;
    const data = targetTab.tableData;
    if (!data) {
      return;
    }

    await runTask(async () => {
      for (const row of rows) {
        await window.xdb.deleteRow({
          profileId: selectedProfileId,
          schema: data.schema,
          table: data.table,
          key: primaryKeyForRow(data.primaryKeys, row)
        });
      }
      await loadObjectTabData(targetTab);
    });
  };

  const deleteRow = async (row: Record<string, unknown>): Promise<void> => {
    await deleteRows([row]);
  };

  const insertRow = async (values: Record<string, unknown>): Promise<void> => {
    if (!activeObjectTab?.tableData || !selectedProfileId) {
      return;
    }

    const targetTab = activeObjectTab;
    const data = targetTab.tableData;
    if (!data) {
      return;
    }

    await runTask(async () => {
      await window.xdb.insertRow({
        profileId: selectedProfileId,
        schema: data.schema,
        table: data.table,
        values
      });
      await loadObjectTabData(targetTab);
    });
  };

  const applyTableChanges = async (
    updates: DraftRowUpdate[],
    insertValues?: Record<string, unknown>
  ): Promise<void> => {
    if (!activeObjectTab?.tableData || !selectedProfileId) {
      return;
    }

    const targetTab = activeObjectTab;
    const data = targetTab.tableData;
    if (!data) {
      return;
    }

    await runTask(async () => {
      for (const update of updates) {
        const changes = targetTab.draftRows[update.rowKey];
        if (!changes || Object.keys(changes).length === 0) {
          continue;
        }

        await window.xdb.updateRow({
          profileId: selectedProfileId,
          schema: data.schema,
          table: data.table,
          key: primaryKeyForRow(data.primaryKeys, update.row),
          values: changes
        });
      }

      if (insertValues && Object.keys(insertValues).length > 0) {
        await window.xdb.insertRow({
          profileId: selectedProfileId,
          schema: data.schema,
          table: data.table,
          values: insertValues
        });
      }

      await loadObjectTabData(targetTab);
    });
  };

  const filteredObjects = useMemo(() => {
    const needle = search.toLowerCase();
    return needle
      ? objects.filter((object) => `${object.schema}.${object.name}`.toLowerCase().includes(needle))
      : objects;
  }, [objects, search]);
  const connectionGroupSections = useMemo(
    () => buildConnectionGroupSections(profiles, connectionGroups),
    [connectionGroups, profiles]
  );
  const contentGridStyle =
    objectsSidebarWidth === null || objectsCollapsed
      ? undefined
      : ({
          "--objects-sidebar-width": `${objectsSidebarWidth}px`
        } as CSSProperties);
  const workspaceFooterControls = (
    <WorkspaceFooterControls
      activeMode={activeMode}
      hasActiveObject={Boolean(activeObjectTab)}
      loading={loading}
      onModeChange={setMode}
    />
  );

  return (
    <>
      <main className="app-shell">
        <section className="workspace">
          <header className="topbar">
            <div className="topbar-connection-picker">
              <button
                className={`icon-button ${connectionsSliderOpen ? "active" : ""}`}
                type="button"
                aria-expanded={connectionsSliderOpen}
                aria-controls="connections-slider"
                title="Opened connections"
                onClick={() => setConnectionsSliderOpen((current) => !current)}
              >
                {connectionsSliderOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
              </button>
              <ConnectionPicker
                connected={connected}
                connectionsLoaded={connectionsLoaded}
                databaseTask={databaseTask}
                open={connectionPickerOpen}
                sections={connectionGroupSections}
                selectedProfile={selectedProfile}
                selectedProfileId={selectedProfileId}
                status={status}
                onConnect={(profileId) => {
                  setConnectionPickerOpen(false);
                  void connect(profileId);
                }}
                onContextMenu={openConnectionContextMenu}
                onDeleteGroup={(groupId) => void deleteConnectionGroup(groupId)}
                onEditGroup={(group) => {
                  setConnectionPickerOpen(false);
                  openEditGroup(group);
                }}
                onNewConnection={() => {
                  setConnectionPickerOpen(false);
                  openNewConnection();
                }}
                onNewGroup={() => {
                  setConnectionPickerOpen(false);
                  openNewGroup();
                }}
                onExportConnections={() => {
                  setConnectionPickerOpen(false);
                  setConnectionExportModalOpen(true);
                }}
                onImportConnections={() => void importConnections()}
                onToggle={() => setConnectionPickerOpen((current) => !current)}
              />
              <button className="icon-button" type="button" title="Reload connections" onClick={() => void refresh()}>
                <RefreshCcw size={16} />
              </button>
            </div>

            <div className="topbar-connection-actions">
              {selectedProfile && selectedProfile.engine !== "sqlite" && !selectedProfile.hasPassword ? (
                <input
                  className="password-input"
                  type="password"
                  placeholder={selectedProfile.engine === "s3-compatible" ? "Secret access key" : "Password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              ) : null}
              {selectedProfile && !connected ? (
                <button className="button primary" type="button" onClick={() => void connect(selectedProfile.id)}>
                  <KeyRound size={15} />
                  Connect
                </button>
              ) : null}
              {connected ? (
                <button className="button secondary" type="button" onClick={() => void disconnect()}>
                  <Unplug size={15} />
                  Disconnect
                </button>
              ) : null}
            </div>

            <div className="topbar-app-actions">
              <button className="icon-button" type="button" title="Settings" onClick={() => setSettingsModalOpen(true)}>
                <Settings size={16} />
              </button>
            </div>
          </header>

          <div
            className={`connections-slider-backdrop ${connectionsSliderOpen ? "open" : ""}`}
            onClick={() => setConnectionsSliderOpen(false)}
            aria-hidden="true"
          />
          <aside
            id="connections-slider"
            className={`connections-slider ${connectionsSliderOpen ? "open" : ""}`}
            aria-label="Opened connections"
            aria-hidden={!connectionsSliderOpen}
          >
            <header className="connections-slider-header">
              <strong>Opened connections</strong>
              <span>{openedProfileIds.length}</span>
              <button
                className="icon-button"
                type="button"
                title="Close"
                onClick={() => setConnectionsSliderOpen(false)}
              >
                <X size={15} />
              </button>
            </header>
            <div className="connections-slider-body">
              {openedProfileIds.length ? (
                <ul className="connections-slider-grid">
                  {openedProfileIds.map((profileId) => {
                    const profile = profiles.find((item) => item.id === profileId);
                    if (!profile) {
                      return null;
                    }
                    const name = profile.name || profile.database || profile.bucket || "Untitled";
                    const isActive = Boolean(status?.connected && status.profileId === profile.id);
                    const tileDragging = draggedTileId === profile.id;
                    const tileDrop = tileDropTarget?.id === profile.id ? `drop-${tileDropTarget.side}` : "";
                    return (
                      <li
                        className={`connection-tile ${isActive ? "active" : ""} ${tileDragging ? "dragging" : ""} ${tileDrop}`}
                        key={profile.id}
                        draggable
                        title={name}
                        onDragStart={(event) => {
                          setDraggedTileId(profile.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", profile.id);
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          if (!draggedTileId || draggedTileId === profile.id) {
                            return;
                          }
                          event.dataTransfer.dropEffect = "move";
                          const rect = event.currentTarget.getBoundingClientRect();
                          const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                          setTileDropTarget((current) =>
                            current?.id === profile.id && current.side === side ? current : { id: profile.id, side }
                          );
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          if (draggedTileId && tileDropTarget?.id === profile.id) {
                            reorderOpenedProfiles(draggedTileId, tileDropTarget.id, tileDropTarget.side);
                          }
                          setDraggedTileId(null);
                          setTileDropTarget(null);
                        }}
                        onDragLeave={() =>
                          setTileDropTarget((current) => (current?.id === profile.id ? null : current))
                        }
                        onDragEnd={() => {
                          setDraggedTileId(null);
                          setTileDropTarget(null);
                        }}
                      >
                        <button
                          className="connection-tile-main"
                          type="button"
                          title={name}
                          onClick={() => {
                            setConnectionsSliderOpen(false);
                            void connect(profile.id);
                          }}
                        >
                          <ConnectionEngineIcon source={profile} />
                          <strong>{name}</strong>
                          <span className="tile-engine">{profile.engine}</span>
                        </button>
                        <i className={`tile-status ${isActive ? "on" : ""}`} />
                        <button
                          className="connection-tile-remove"
                          type="button"
                          title={`Remove ${name} from list`}
                          aria-label={`Remove ${name} from list`}
                          onClick={() => void removeOpenedProfile(profileId)}
                        >
                          <X size={13} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="connections-slider-empty">No opened connections yet</p>
              )}
            </div>
          </aside>

          {connecting ? (
            <ConnectionLoader profile={connectingProfile} />
          ) : connectedStorage ? (
            <StorageWorkspace
              metadata={storageMetadata}
              objects={storageObjects}
              prefix={storagePrefix}
              preview={storagePreview}
              selectedObject={selectedStorageObject}
              canGoBack={storagePrefix !== ""}
              canPageBack={storagePreviousTokens.length > 0}
              canPageForward={Boolean(storageNextToken)}
              onBack={openParentStorageFolder}
              onCopy={copySelectedStorageObject}
              onCreateFolder={createStorageFolder}
              onDelete={deleteSelectedStorageObject}
              onDownload={downloadSelectedStorageObject}
              onMove={moveSelectedStorageObject}
              onNextPage={loadNextStoragePage}
              onOpenFolder={openStorageFolder}
              onPreview={previewSelectedStorageObject}
              onPreviousPage={loadPreviousStoragePage}
              onRefresh={() =>
                void runTask(() => loadStorageObjects(selectedProfileId, storagePrefix, storageContinuationToken))
              }
              onSelect={(object) => void selectStorageObject(object)}
              onUploadFiles={uploadStorageFiles}
              onUploadFolder={uploadStorageFolder}
            />
          ) : connectedDatabase ? (
            <div className={`content-grid ${objectsCollapsed ? "objects-collapsed" : ""}`} style={contentGridStyle}>
              <aside className={`object-browser ${objectsCollapsed ? "collapsed" : ""}`}>
                <div className="object-browser-toolbar">
                  {objectsCollapsed ? (
                    <Table2 size={17} />
                  ) : (
                    <div className="search-box">
                      <Search size={15} />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search tables and views"
                      />
                    </div>
                  )}
                  <button
                    className="icon-button"
                    type="button"
                    title={objectsCollapsed ? "Expand tables" : "Collapse tables"}
                    aria-label={objectsCollapsed ? "Expand tables" : "Collapse tables"}
                    aria-expanded={!objectsCollapsed}
                    onClick={() => setObjectsCollapsed((current) => !current)}
                  >
                    {objectsCollapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
                  </button>
                </div>
                {objectsCollapsed ? null : (
                  <>
                    <TablesSidebar
                      activeObject={selectedObject}
                      objects={filteredObjects}
                      openTabIds={openObjectTabIds}
                      previewObjectId={previewObjectTabId}
                      profileId={selectedProfileId}
                      onPin={pinObjectTab}
                      onPreview={openObjectPreview}
                    />
                    <button
                      className="object-browser-resize-handle"
                      type="button"
                      title="Drag to resize tables sidebar. Double-click to reset."
                      aria-label="Resize tables sidebar"
                      onDoubleClick={resetObjectsSidebarWidth}
                      onPointerDown={startObjectsSidebarResize}
                    />
                  </>
                )}
              </aside>
              <section className="main-panel">
                <ObjectTabs
                  activeTabId={activeObjectTabId}
                  objectsCollapsed={objectsCollapsed}
                  tabs={objectTabs}
                  onClose={closeObjectTab}
                  onExpandObjects={() => setObjectsCollapsed(false)}
                  onFocus={focusObjectTab}
                  onPin={pinOpenObjectTab}
                  onReorder={reorderObjectTab}
                />

                {activeMode === "data" ? (
                  activeObjectTab ? (
                    <TableDataView
                      appliedFilterCount={countAppliedFilterRules(activeFilters)}
                      data={activeTableData}
                      draftRows={activeDraftRows}
                      draftFilters={activeDraftFilters}
                      filtersVisible={activeFiltersVisible}
                      footerEnd={workspaceFooterControls}
                      key={activeObjectTab.id}
                      page={activeObjectTab.page}
                      profileId={selectedProfileId}
                      stagedRow={activeStagedRow}
                      tableSort={activeTableSort}
                      onAddFilterRule={addFilterRule}
                      onCellChange={applyCellChange}
                      onCancelStagedRow={cancelStagedRow}
                      onApplyFilters={applyFilters}
                      onDeleteRow={deleteRow}
                      onDeleteRows={deleteRows}
                      onClearFilters={clearFilters}
                      onFilterRuleChange={updateFilterRule}
                      onApplyChanges={(updates, insertValues) => void applyTableChanges(updates, insertValues)}
                      onInsertRow={(values) => void insertRow(values)}
                      onOpenFilteredTab={(column, value) =>
                        openFilteredObjectTab(activeObjectTab.object, column, value)
                      }
                      onPageChange={setActiveTabPage}
                      onRemoveFilterRule={removeFilterRule}
                      onRefresh={() => void refreshObjectTab(activeObjectTab)}
                      onResetChanges={resetTableChanges}
                      onStageRow={startStagedRow}
                      onStagedRowChange={applyStagedRowChange}
                      onSortChange={changeTableSort}
                      onToggleFilters={toggleFilters}
                    />
                  ) : (
                    <EmptyObjectPrompt />
                  )
                ) : null}

                {activeMode === "query" ? (
                  <QueryView
                    activeSavedQueryId={activeSavedQueryId}
                    connectedDatabase={connectedDatabase}
                    savedQueryName={savedQueryName}
                    sqlText={sqlText}
                    result={queryResult}
                    theme={resolvedTheme}
                    onChange={updateSqlText}
                    onExecute={() => void executeSql()}
                    onSavedQueryNameChange={setSavedQueryName}
                    onSave={() => void saveCurrentSqlQuery(false)}
                    onSaveAsNew={() => void saveCurrentSqlQuery(true)}
                    onShowSaved={() => setMode("saved")}
                  />
                ) : null}

                {activeMode === "saved" ? (
                  <SavedQueriesView
                    activeSavedQueryId={activeSavedQueryId}
                    savedQueries={savedQueries}
                    onDelete={(query) => void deleteSavedSqlQuery(query)}
                    onOpen={(query) => void loadSavedQueryIntoEditor(query)}
                  />
                ) : null}

                {activeMode === "structure" ? (
                  activeObjectTab ? (
                    <StructureView structure={activeStructure} />
                  ) : (
                    <EmptyObjectPrompt />
                  )
                ) : null}

                {activeMode === "history" ? (
                  <HistoryView
                    history={history}
                    onClear={() =>
                      void runTask(async () => {
                        await window.xdb.clearHistory();
                        await loadHistory(selectedProfileId);
                      })
                    }
                    onUse={(sqlFromHistory) => {
                      updateSqlText(sqlFromHistory, { savedQueryId: null });
                      setSavedQueryName("");
                      setMode("query");
                    }}
                  />
                ) : null}
                {activeMode !== "data" ? <WorkspaceModeFooter>{workspaceFooterControls}</WorkspaceModeFooter> : null}
              </section>
            </div>
          ) : (
            <div className="empty-workspace">
              <p>Connect to a database or bucket to start exploring data.</p>
            </div>
          )}
        </section>

        {contextMenu ? (
          <div
            className="context-menu"
            style={{
              left: contextMenu.x,
              top: contextMenu.y
            }}
          >
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void connect(contextMenu.profileId);
              }}
            >
              <KeyRound size={14} />
              Connect
            </button>
            <button
              type="button"
              onClick={() => {
                setContextMenu(null);
                void openEditConnection(contextMenu.profileId);
              }}
            >
              <Pencil size={14} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                const { profileId } = contextMenu;
                setContextMenu(null);
                void copyConnectionString(profileId);
              }}
            >
              <Clipboard size={14} />
              Copy connection string
            </button>
            <button
              type="button"
              onClick={() => {
                const { profileId } = contextMenu;
                setContextMenu(null);
                void duplicateConnection(profileId);
              }}
            >
              <Plus size={14} />
              Duplicate
            </button>
            {profiles.find((profile) => profile.id === contextMenu.profileId)?.engine === "postgresql" ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const { profileId } = contextMenu;
                    setContextMenu(null);
                    void openDatabaseList(profileId);
                  }}
                >
                  <Database size={14} />
                  Databases…
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { profileId } = contextMenu;
                    setContextMenu(null);
                    void backupDatabase(profileId);
                  }}
                >
                  <Download size={14} />
                  Backup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const { profileId } = contextMenu;
                    setContextMenu(null);
                    void restoreDatabase(profileId);
                  }}
                >
                  <Upload size={14} />
                  Restore
                </button>
              </>
            ) : null}
            <button
              className="danger"
              type="button"
              onClick={() => {
                setContextMenu(null);
                void deleteProfile(contextMenu.profileId);
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        ) : null}

        {modalOpen ? (
          <ConnectionModal
            groups={connectionGroups}
            initial={modalInitial ?? undefined}
            onClose={closeConnectionModal}
            onSave={(input) => void saveProfile(input)}
            onTest={(input) => testConnection(input)}
          />
        ) : null}

        {connectionExportModalOpen ? (
          <ConnectionExportModal
            onClose={() => setConnectionExportModalOpen(false)}
            onExport={(includeSecrets) => void exportConnections(includeSecrets)}
          />
        ) : null}

        {databaseListProfileId
          ? (() => {
              const sourceProfile = profiles.find((item) => item.id === databaseListProfileId) ?? null;
              const existingDatabaseNames = new Set(
                profiles
                  .filter(
                    (item) =>
                      item.engine === "postgresql" &&
                      sourceProfile != null &&
                      item.host === sourceProfile.host &&
                      item.port === sourceProfile.port &&
                      item.user === sourceProfile.user
                  )
                  .map((item) => item.database)
              );
              return (
                <DatabaseListModal
                  profile={sourceProfile}
                  databases={databaseList}
                  existingDatabaseNames={existingDatabaseNames}
                  loading={databaseListLoading}
                  onClose={closeDatabaseList}
                  onCreateConnection={(dbName) => void createConnectionForDatabase(databaseListProfileId, dbName)}
                  onCreateDatabase={(dbName) => createDatabase(databaseListProfileId, dbName)}
                  onDropDatabase={(dbName) =>
                    setDatabaseDropConfirmation({ profileId: databaseListProfileId, databaseName: dbName })
                  }
                />
              );
            })()
          : null}

        {databaseDropConfirmation ? (
          <DatabaseDropConfirmationDialog
            databaseName={databaseDropConfirmation.databaseName}
            onCancel={() => setDatabaseDropConfirmation(null)}
            onConfirm={() =>
              void dropDatabase(databaseDropConfirmation.profileId, databaseDropConfirmation.databaseName)
            }
          />
        ) : null}

        {settingsModalOpen ? (
          <SettingsModal
            resolvedTheme={resolvedTheme}
            settings={appSettings}
            onClose={() => setSettingsModalOpen(false)}
            onThemeChange={(theme) => void saveThemePreference(theme)}
          />
        ) : null}

        {groupModalOpen ? (
          <ConnectionGroupModal
            initial={groupModalInitial ?? undefined}
            onClose={() => {
              setGroupModalOpen(false);
              setGroupModalInitial(null);
            }}
            onSave={(input) => void saveConnectionGroup(input)}
          />
        ) : null}

        {closeObjectTabConfirmation ? (
          <CloseObjectTabConfirmationDialog
            tab={objectTabs.find((item) => item.id === closeObjectTabConfirmation.tabId) ?? null}
            onCancel={() => setCloseObjectTabConfirmation(null)}
            onConfirm={() => closeObjectTabNow(closeObjectTabConfirmation.tabId)}
          />
        ) : null}
      </main>
      <Toaster
        closeButton
        richColors
        theme={resolvedTheme}
        position="top-right"
        toastOptions={{
          classNames: {
            description: "toast-description"
          }
        }}
      />
    </>
  );
}

function SettingsModal({
  resolvedTheme,
  settings,
  onClose,
  onThemeChange
}: {
  resolvedTheme: ResolvedTheme;
  settings: AppSettings;
  onClose: () => void;
  onThemeChange: (theme: ThemePreference) => void;
}): ReactElement {
  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="connection-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header>
          <h1 id="settings-title">Settings</h1>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="settings-modal-body">
          <section className="settings-section" aria-labelledby="settings-appearance-title">
            <div className="settings-section-header">
              <h2 id="settings-appearance-title">Appearance</h2>
              <p>Current theme resolves to {resolvedTheme}.</p>
            </div>
            <fieldset className="settings-theme-options" aria-label="Theme">
              <ThemeOptionButton
                active={settings.theme === "system"}
                icon={<Monitor size={15} />}
                label="System"
                onClick={() => onThemeChange("system")}
              />
              <ThemeOptionButton
                active={settings.theme === "light"}
                icon={<Sun size={15} />}
                label="Light"
                onClick={() => onThemeChange("light")}
              />
              <ThemeOptionButton
                active={settings.theme === "dark"}
                icon={<Moon size={15} />}
                label="Dark"
                onClick={() => onThemeChange("dark")}
              />
            </fieldset>
          </section>

          <section className="settings-section" aria-labelledby="settings-about-title">
            <div className="settings-section-header">
              <h2 id="settings-about-title">About</h2>
            </div>
            <div className="settings-about">
              <img className="settings-logo" src="/logo.svg" alt="XDB logo" />
              <p className="settings-about-line">
                <strong>XDB</strong>
                <span className="settings-app-version">v{appVersion}</span>
                <span>Local database console for PostgreSQL, MySQL &amp; SQLite.</span>
              </p>
            </div>
          </section>
        </div>
      </section>
    </ModalBackdrop>
  );
}

function ConnectionExportModal({
  onClose,
  onExport
}: {
  onClose: () => void;
  onExport: (includeSecrets: boolean) => void;
}): ReactElement {
  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="connection-modal connection-export-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-export-title"
      >
        <header>
          <h1 id="connection-export-title">Export Connections</h1>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="connection-export-options">
          <button className="connection-export-option" type="button" onClick={() => onExport(false)}>
            <EyeOff size={16} />
            <span>
              <strong>Safe export</strong>
              <small>Connection metadata only. Passwords and tokens are left out.</small>
            </span>
          </button>
          <button className="connection-export-option warning" type="button" onClick={() => onExport(true)}>
            <KeyRound size={16} />
            <span>
              <strong>Complete backup</strong>
              <small>Includes saved passwords and tokens as plaintext JSON.</small>
            </span>
          </button>
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}

function DatabaseListModal({
  profile,
  databases,
  existingDatabaseNames,
  loading,
  onClose,
  onCreateConnection,
  onCreateDatabase,
  onDropDatabase
}: {
  profile: ConnectionProfile | null;
  databases: DatabaseInfo[] | null;
  existingDatabaseNames: Set<string>;
  loading: boolean;
  onClose: () => void;
  onCreateConnection: (dbName: string) => void;
  onCreateDatabase: (dbName: string) => Promise<boolean>;
  onDropDatabase: (dbName: string) => void;
}): ReactElement {
  const [newDatabaseName, setNewDatabaseName] = useState("");
  const [creating, setCreating] = useState(false);
  const serverLabel = profile ? `${profile.host}:${profile.port}` : "";
  const normalizedNewDatabaseName = newDatabaseName.trim();
  const databaseExists = databases?.some((database) => database.name === normalizedNewDatabaseName) ?? false;

  const submitDatabase = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!normalizedNewDatabaseName || databaseExists || loading) {
      return;
    }

    setCreating(true);
    if (await onCreateDatabase(normalizedNewDatabaseName)) {
      setNewDatabaseName("");
    }
    setCreating(false);
  };

  return (
    <ModalBackdrop onClose={onClose}>
      <section
        className="connection-modal database-list-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="database-list-title"
      >
        <header>
          <h1 id="database-list-title">Databases{serverLabel ? ` · ${serverLabel}` : ""}</h1>
          <button className="icon-button" type="button" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="database-list-body">
          <form className="database-create-form" onSubmit={(event) => void submitDatabase(event)}>
            <label>
              <span>New database</span>
              <input
                className="field-control"
                type="text"
                maxLength={63}
                placeholder="Database name"
                value={newDatabaseName}
                onChange={(event) => setNewDatabaseName(event.target.value)}
              />
            </label>
            <button
              className="button primary"
              type="submit"
              disabled={!normalizedNewDatabaseName || databaseExists || loading}
              title={databaseExists ? "This database already exists" : "Create database"}
            >
              {creating ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
              {creating ? "Creating" : "Create database"}
            </button>
          </form>

          {loading && !databases ? (
            <p className="database-list-empty">
              <Loader2 className="spin" size={16} /> Loading databases…
            </p>
          ) : !databases || databases.length === 0 ? (
            <p className="database-list-empty">No databases found.</p>
          ) : (
            <ul className="database-list">
              {databases.map((db) => {
                const exists = existingDatabaseNames.has(db.name);
                return (
                  <li className="database-list-row" key={db.name}>
                    <Database size={15} />
                    <span className="database-list-info">
                      <strong>
                        {db.name}
                        {db.isCurrent ? <em className="database-list-badge">current</em> : null}
                      </strong>
                      {db.owner ? <small>owner: {db.owner}</small> : null}
                    </span>
                    <span className="database-list-actions">
                      <button
                        className="button secondary"
                        type="button"
                        disabled={exists || loading}
                        title={
                          exists
                            ? "A connection for this database already exists"
                            : "Create a connection for this database"
                        }
                        onClick={() => onCreateConnection(db.name)}
                      >
                        {exists ? "Added" : "Create connection"}
                      </button>
                      <button
                        className="button danger"
                        type="button"
                        disabled={db.isCurrent || !db.canDrop || loading}
                        title={
                          db.isCurrent
                            ? "The database used by this connection cannot be dropped"
                            : !db.canDrop
                              ? "The connected user does not own this database"
                              : `Drop ${db.name}`
                        }
                        onClick={() => onDropDatabase(db.name)}
                      >
                        <Trash2 size={14} />
                        Drop
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}

function DatabaseDropConfirmationDialog({
  databaseName,
  onCancel,
  onConfirm
}: {
  databaseName: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ModalBackdrop onClose={onCancel}>
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="drop-database-title">
        <header>
          <div>
            <h1 id="drop-database-title">Drop database?</h1>
            <span>This cannot be undone</span>
          </div>
          <button className="icon-button" type="button" title="Cancel drop" onClick={onCancel}>
            <X size={15} />
          </button>
        </header>

        <div className="confirmation-dialog-body">
          <p>The database and all of its data will be permanently deleted. Saved XDB connections are kept.</p>
          <code>{databaseName}</code>
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button danger" type="button" onClick={onConfirm}>
            <Trash2 size={15} />
            Drop database
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}

function ThemeOptionButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <label className={`settings-theme-option ${active ? "active" : ""}`}>
      <input className="settings-theme-input" type="radio" name="theme" checked={active} onChange={onClick} />
      {icon}
      <span>{label}</span>
    </label>
  );
}

const CONNECTION_TRIGGER_NAME_MAX = 10;

function shortConnectionName(name: string): string {
  return name.length <= CONNECTION_TRIGGER_NAME_MAX ? name : `${name.slice(0, CONNECTION_TRIGGER_NAME_MAX)}…`;
}

function ConnectionPicker({
  connected,
  connectionsLoaded,
  databaseTask,
  open,
  sections: rawSections,
  selectedProfile,
  selectedProfileId,
  status,
  onConnect,
  onContextMenu,
  onDeleteGroup,
  onEditGroup,
  onExportConnections,
  onImportConnections,
  onNewConnection,
  onNewGroup,
  onToggle
}: {
  connected: boolean;
  connectionsLoaded: boolean;
  databaseTask: DatabaseTask | null;
  open: boolean;
  sections: ConnectionGroupSection[];
  selectedProfile: ConnectionProfile | null;
  selectedProfileId: string;
  status: ConnectionRuntimeStatus | null;
  onConnect: (profileId: string) => void;
  onContextMenu: (profileId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onDeleteGroup: (groupId: string) => void;
  onEditGroup: (group: ConnectionGroup) => void;
  onExportConnections: () => void;
  onImportConnections: () => void;
  onNewConnection: () => void;
  onNewGroup: () => void;
  onToggle: () => void;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const {
    sections,
    isCollapsed,
    toggleCollapsed,
    reorderGroup,
    reorderConnection,
    scrollTop,
    saveScrollTop,
    loaded: layoutLoaded
  } = useConnectionPickerLayout(rawSections);
  const [draggedGroupKey, setDraggedGroupKey] = useState<string | null>(null);
  const [groupDropTarget, setGroupDropTarget] = useState<GroupDropTarget | null>(null);
  const [draggedConnection, setDraggedConnection] = useState<{ groupKey: string; profileId: string } | null>(null);
  const [connectionDropTarget, setConnectionDropTarget] = useState<ConnectionDropTarget | null>(null);
  const listReady = connectionsLoaded && layoutLoaded;
  const subtitle = !connectionsLoaded
    ? "Loading connections..."
    : connected
      ? connectionStatusLabel(status)
      : selectedProfile
        ? profileDisplayTarget(selectedProfile)
        : "Create a database connection";
  const totalConnections = sections.reduce((count, section) => count + section.connections.length, 0);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (menuRef.current) {
        menuRef.current.scrollTop = scrollTop;
      }
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open, scrollTop]);

  const endGroupDrag = (): void => {
    setDraggedGroupKey(null);
    setGroupDropTarget(null);
  };

  const updateGroupDropTarget = (groupKey: string, event: DragEvent<HTMLElement>): void => {
    if (!draggedGroupKey || draggedGroupKey === groupKey) {
      setGroupDropTarget(null);
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setGroupDropTarget({ groupKey, side });
  };

  const dropGroup = (groupKey: string, event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    if (!draggedGroupKey || !groupDropTarget || groupDropTarget.groupKey !== groupKey) {
      endGroupDrag();
      return;
    }

    reorderGroup(draggedGroupKey, groupKey, groupDropTarget.side);
    endGroupDrag();
  };

  const endConnectionDrag = (): void => {
    setDraggedConnection(null);
    setConnectionDropTarget(null);
  };

  const clearConnectionDropTarget = (): void => {
    setConnectionDropTarget(null);
  };

  const updateConnectionDropTarget = (groupKey: string, profileId: string, event: DragEvent<HTMLElement>): void => {
    if (!draggedConnection || draggedConnection.groupKey !== groupKey || draggedConnection.profileId === profileId) {
      setConnectionDropTarget(null);
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    setConnectionDropTarget({ groupKey, profileId, side });
  };

  const dropConnection = (groupKey: string, profileId: string, event: DragEvent<HTMLElement>): void => {
    event.preventDefault();
    if (
      !draggedConnection ||
      !connectionDropTarget ||
      connectionDropTarget.groupKey !== groupKey ||
      connectionDropTarget.profileId !== profileId ||
      draggedConnection.groupKey !== groupKey
    ) {
      endConnectionDrag();
      return;
    }

    reorderConnection(groupKey, draggedConnection.profileId, profileId, connectionDropTarget.side);
    endConnectionDrag();
  };

  const handleMenuScroll = (): void => {
    if (!menuRef.current) {
      return;
    }
    saveScrollTop(menuRef.current.scrollTop);
  };

  return (
    <div className="connection-picker-wrap">
      <button
        className="connection-picker-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={selectedProfile ? `${selectedProfile.name || selectedProfile.database} / ${subtitle}` : "Connections"}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
      >
        <span className="server-icon">
          {selectedProfile ? <ConnectionEngineIcon source={selectedProfile} /> : <Server size={18} />}
          {connected ? <span className="status-dot" /> : null}
        </span>
        <span className="connection-picker-trigger-copy">
          <strong
            title={selectedProfile?.name || selectedProfile?.database || selectedProfile?.bucket || "No connection"}
          >
            {shortConnectionName(
              selectedProfile?.name || selectedProfile?.database || selectedProfile?.bucket || "No connection"
            )}
          </strong>
          <span>{subtitle}</span>
        </span>
        <ChevronDown size={15} />
      </button>

      {open ? (
        <div className="connection-picker-menu" ref={menuRef} role="menu" onScroll={handleMenuScroll}>
          <div className="connection-picker-header">
            <strong>Connections</strong>
            <span>{listReady ? totalConnections : "…"}</span>
            <div className="connection-picker-actions">
              <button className="icon-button" type="button" title="New connection" onClick={onNewConnection}>
                <Plus size={15} />
              </button>
              <button className="icon-button" type="button" title="New group" onClick={onNewGroup}>
                <FolderPlus size={15} />
              </button>
              <button className="icon-button" type="button" title="Import connections" onClick={onImportConnections}>
                <FileUp size={15} />
              </button>
              <button className="icon-button" type="button" title="Export connections" onClick={onExportConnections}>
                <FileDown size={15} />
              </button>
            </div>
          </div>
          {!listReady ? (
            <p className="connection-picker-empty">Loading connections…</p>
          ) : sections.length ? (
            sections.map((section) => {
              const sectionKey = connectionGroupSectionKey(section);
              const groupDragging = draggedGroupKey === sectionKey;
              const groupDropping = groupDropTarget?.groupKey === sectionKey ? `drop-${groupDropTarget.side}` : "";

              return (
                <ConnectionPickerGroup
                  collapsed={isCollapsed(sectionKey)}
                  connectionDropTarget={connectionDropTarget}
                  databaseTask={databaseTask}
                  draggedConnection={draggedConnection}
                  dragging={groupDragging}
                  dropClass={groupDropping}
                  groupKey={sectionKey}
                  key={sectionKey}
                  section={section}
                  selectedProfileId={selectedProfileId}
                  onConnect={onConnect}
                  onContextMenu={onContextMenu}
                  onDeleteGroup={onDeleteGroup}
                  onEditGroup={onEditGroup}
                  onConnectionDragEnd={endConnectionDrag}
                  onConnectionDragLeave={clearConnectionDropTarget}
                  onConnectionDragOver={updateConnectionDropTarget}
                  onConnectionDragStart={(profileId) => setDraggedConnection({ groupKey: sectionKey, profileId })}
                  onConnectionDrop={dropConnection}
                  onGroupDragEnd={endGroupDrag}
                  onGroupDragLeave={() => setGroupDropTarget(null)}
                  onGroupDragOver={updateGroupDropTarget}
                  onGroupDragStart={() => setDraggedGroupKey(sectionKey)}
                  onGroupDrop={dropGroup}
                  onToggle={() => toggleCollapsed(sectionKey)}
                />
              );
            })
          ) : (
            <p className="connection-picker-empty">No connections saved</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ConnectionPickerGroup({
  collapsed,
  connectionDropTarget,
  databaseTask,
  draggedConnection,
  dragging,
  dropClass,
  groupKey,
  section,
  selectedProfileId,
  onConnect,
  onContextMenu,
  onConnectionDragEnd,
  onConnectionDragLeave,
  onConnectionDragOver,
  onConnectionDragStart,
  onConnectionDrop,
  onDeleteGroup,
  onEditGroup,
  onGroupDragEnd,
  onGroupDragLeave,
  onGroupDragOver,
  onGroupDragStart,
  onGroupDrop,
  onToggle
}: {
  collapsed: boolean;
  connectionDropTarget: ConnectionDropTarget | null;
  databaseTask: DatabaseTask | null;
  draggedConnection: { groupKey: string; profileId: string } | null;
  dragging: boolean;
  dropClass: string;
  groupKey: string;
  section: ConnectionGroupSection;
  selectedProfileId: string;
  onConnect: (profileId: string) => void;
  onContextMenu: (profileId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onConnectionDragEnd: () => void;
  onConnectionDragLeave: () => void;
  onConnectionDragOver: (groupKey: string, profileId: string, event: DragEvent<HTMLElement>) => void;
  onConnectionDragStart: (profileId: string) => void;
  onConnectionDrop: (groupKey: string, profileId: string, event: DragEvent<HTMLElement>) => void;
  onDeleteGroup: (groupId: string) => void;
  onEditGroup: (group: ConnectionGroup) => void;
  onGroupDragEnd: () => void;
  onGroupDragLeave: () => void;
  onGroupDragOver: (groupKey: string, event: DragEvent<HTMLElement>) => void;
  onGroupDragStart: () => void;
  onGroupDrop: (groupKey: string, event: DragEvent<HTMLElement>) => void;
  onToggle: () => void;
}): ReactElement {
  const group = section.group;
  const groupName = group?.name ?? "Ungrouped";
  const groupColor = group?.color ?? "#888888";

  return (
    <section
      className={`connection-picker-group ${dragging ? "dragging" : ""} ${dropClass}`}
      aria-label={groupName}
      onDragOver={(event) => onGroupDragOver(groupKey, event)}
      onDrop={(event) => onGroupDrop(groupKey, event)}
      onDragLeave={onGroupDragLeave}
    >
      <div className="connection-picker-group-header">
        <button
          className="connection-picker-drag-handle"
          type="button"
          draggable
          title={`Drag to reorder ${groupName}`}
          aria-label={`Drag to reorder ${groupName}`}
          onClick={(event) => event.stopPropagation()}
          onDragEnd={onGroupDragEnd}
          onDragStart={(event) => {
            event.stopPropagation();
            onGroupDragStart();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", groupKey);
          }}
        >
          <GripVertical size={12} />
        </button>
        <button
          className="connection-picker-group-toggle"
          type="button"
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} ${groupName}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          <Folder size={14} style={{ color: groupColor }} />
          <span>{groupName}</span>
          <small>{section.connections.length}</small>
        </button>
        {group ? (
          <span className="connection-picker-group-actions">
            <button
              className="icon-button"
              type="button"
              title={`Edit ${groupName}`}
              onClick={() => onEditGroup(group)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-button danger"
              type="button"
              title={`Delete ${groupName}`}
              onClick={() => onDeleteGroup(group.id)}
            >
              <Trash2 size={13} />
            </button>
          </span>
        ) : null}
      </div>
      {collapsed ? null : section.connections.length ? (
        <ul className="connection-picker-group-list" aria-label={`${groupName} connections`}>
          {section.connections.map((profile) => {
            const connectionDragging =
              draggedConnection?.groupKey === groupKey && draggedConnection.profileId === profile.id;
            const connectionDropping =
              connectionDropTarget?.groupKey === groupKey && connectionDropTarget.profileId === profile.id
                ? `drop-${connectionDropTarget.side}`
                : "";

            return (
              <ConnectionPickerRow
                databaseTask={databaseTask}
                dragging={connectionDragging}
                dropClass={connectionDropping}
                key={profile.id}
                profile={profile}
                selected={profile.id === selectedProfileId}
                onConnect={onConnect}
                onContextMenu={onContextMenu}
                onDragEnd={onConnectionDragEnd}
                onDragLeave={onConnectionDragLeave}
                onDragOver={(event) => onConnectionDragOver(groupKey, profile.id, event)}
                onDragStart={() => onConnectionDragStart(profile.id)}
                onDrop={(event) => onConnectionDrop(groupKey, profile.id, event)}
              />
            );
          })}
        </ul>
      ) : (
        <p className="connection-picker-empty">No connections</p>
      )}
    </section>
  );
}

function ConnectionPickerRow({
  databaseTask,
  dragging,
  dropClass,
  profile,
  selected,
  onConnect,
  onContextMenu,
  onDragEnd,
  onDragLeave,
  onDragOver,
  onDragStart,
  onDrop
}: {
  databaseTask: DatabaseTask | null;
  dragging: boolean;
  dropClass: string;
  profile: ConnectionProfile;
  selected: boolean;
  onConnect: (profileId: string) => void;
  onContextMenu: (profileId: string, event: MouseEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragLeave: () => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDragStart: () => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}): ReactElement {
  const activeTask = databaseTask?.profileId === profile.id ? databaseTask.type : null;
  const title = activeTask
    ? `${activeTask === "backup" ? "Backing up" : "Restoring"} ${profile.name || profile.database}`
    : `${profile.name || profile.database || profile.bucket} / ${profileDisplayTarget(profile)}`;
  const profileLabel = profile.name || profile.database || profile.bucket;

  return (
    <li
      className={`connection-picker-row ${selected ? "active" : ""} ${dragging ? "dragging" : ""} ${dropClass}`}
      title={title}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
    >
      <button
        className="connection-picker-drag-handle"
        type="button"
        draggable
        title={`Drag to reorder ${profileLabel}`}
        aria-label={`Drag to reorder ${profileLabel}`}
        onClick={(event) => event.stopPropagation()}
        onDragEnd={onDragEnd}
        onDragStart={(event) => {
          event.stopPropagation();
          onDragStart();
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", profile.id);
        }}
      >
        <GripVertical size={12} />
      </button>
      <button
        className="connection-picker-row-main"
        disabled={Boolean(activeTask)}
        role="menuitem"
        type="button"
        onClick={() => onConnect(profile.id)}
        onContextMenu={(event) => onContextMenu(profile.id, event)}
      >
        <span className="connection-picker-status" style={{ background: profile.color }}>
          {activeTask ? <Loader2 className="spin" size={10} /> : null}
        </span>
        <span className="connection-label">
          <span className="connection-name">
            <ConnectionEngineIcon source={profile} />
            <strong>{profile.name || profile.database || profile.bucket}</strong>
          </span>
          <small>
            {activeTask
              ? activeTask === "backup"
                ? "Creating backup"
                : "Restoring backup"
              : profileConnectionSubtitle(profile)}
          </small>
        </span>
      </button>
      <button
        className="connection-picker-row-actions"
        type="button"
        title={`Manage ${profile.name || profile.database || profile.bucket}`}
        onClick={(event) => onContextMenu(profile.id, event)}
      >
        <SlidersHorizontal size={13} />
      </button>
    </li>
  );
}

type ConnectionIconSource = Partial<
  Pick<ConnectionProfile, "engine" | "iconMode" | "iconName" | "iconEmoji" | "iconImage">
>;

function ConnectionEngineIcon({
  source,
  className
}: {
  source: ConnectionIconSource;
  className?: string;
}): ReactElement {
  const iconMode = source.iconMode ?? "default";
  if (iconMode === "emoji" && source.iconEmoji) {
    return (
      <span className={`connection-custom-icon emoji ${className ?? ""}`.trim()} aria-hidden="true">
        {source.iconEmoji}
      </span>
    );
  }
  if (iconMode === "image" && source.iconImage) {
    return (
      <img
        alt=""
        aria-hidden="true"
        className={`connection-custom-icon image ${className ?? ""}`.trim()}
        src={source.iconImage}
      />
    );
  }
  if (iconMode === "icon" && source.iconName && CONNECTION_ICONS[source.iconName]) {
    const Icon = CONNECTION_ICONS[source.iconName];
    return <Icon aria-hidden="true" className={`connection-custom-icon lucide ${className ?? ""}`.trim()} size={14} />;
  }
  if (!source.engine) {
    return (
      <Database
        className={`connection-custom-icon placeholder ${className ?? ""}`.trim()}
        aria-hidden="true"
        size={14}
      />
    );
  }
  return <DatabaseEngineLogo engine={source.engine} className={className ?? "connection-engine-icon"} />;
}

function DatabaseEngineLogo({ className, engine }: { className: string; engine: ConnectionEngine }): ReactElement {
  return <img alt="" aria-hidden="true" className={className} src={ENGINE_ICON_URLS[engine]} />;
}

function TablesSidebar({
  activeObject,
  objects,
  openTabIds,
  previewObjectId,
  profileId,
  onPin,
  onPreview
}: {
  activeObject: DatabaseObject | null;
  objects: DatabaseObject[];
  openTabIds: Set<string>;
  previewObjectId: string | null;
  profileId: string;
  onPin: (object: DatabaseObject) => void;
  onPreview: (object: DatabaseObject) => void;
}): ReactElement {
  const grouped = useMemo(() => {
    const groups = new Map<string, DatabaseObject[]>();
    for (const object of objects) {
      groups.set(object.schema, [...(groups.get(object.schema) ?? []), object]);
    }
    return [...groups.entries()];
  }, [objects]);

  return (
    <div className="object-tree">
      {grouped.map(([schema, schemaObjects]) => (
        <details key={schema} open>
          <summary title={schema}>
            <ChevronDown className="schema-chevron" size={13} />
            <Folder className="schema-icon" size={13} />
            <span>{schema}</span>
          </summary>
          {schemaObjects.map((object) => {
            const tabId = objectTabId(profileId, object);
            const active = activeObject?.schema === object.schema && activeObject.name === object.name;
            const open = openTabIds.has(tabId);
            const preview = previewObjectId === tabId;
            const objectLabel = objectDisplayName(object);
            const objectKind = isTableObject(object) ? "table" : "view";

            return (
              <button
                className={`object-item ${active ? "active" : ""} ${open ? "open" : ""} ${preview ? "preview" : ""}`}
                key={`${object.schema}.${object.name}`}
                type="button"
                title={objectLabel}
                aria-label={`Open ${objectKind} ${objectLabel}`}
                onClick={() => onPreview(object)}
                onDoubleClick={() => onPin(object)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onPin(object);
                  }
                }}
              >
                {isTableObject(object) ? (
                  <Table2 className="object-item-icon" size={12} />
                ) : (
                  <Braces className="object-item-icon" size={12} />
                )}
                <span>{object.name}</span>
              </button>
            );
          })}
        </details>
      ))}
    </div>
  );
}

function ObjectTabs({
  activeTabId,
  objectsCollapsed,
  tabs,
  onClose,
  onExpandObjects,
  onFocus,
  onPin,
  onReorder
}: {
  activeTabId: ObjectTabId | null;
  objectsCollapsed: boolean;
  tabs: ObjectTab[];
  onClose: (tabId: ObjectTabId) => void;
  onExpandObjects: () => void;
  onFocus: (tabId: ObjectTabId) => void;
  onPin: (tabId: ObjectTabId) => void;
  onReorder: (sourceTabId: ObjectTabId, targetTabId: ObjectTabId, side: "before" | "after") => void;
}): ReactElement {
  const [draggedTabId, setDraggedTabId] = useState<ObjectTabId | null>(null);
  const [dropTarget, setDropTarget] = useState<ObjectTabDropTarget | null>(null);

  const updateDropTarget = (tabId: ObjectTabId, event: DragEvent<HTMLButtonElement>): void => {
    if (!draggedTabId || draggedTabId === tabId) {
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setDropTarget({ tabId, side });
  };

  const dropTab = (targetTabId: ObjectTabId, event: DragEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    if (!draggedTabId || !dropTarget) {
      setDraggedTabId(null);
      setDropTarget(null);
      return;
    }

    onReorder(draggedTabId, targetTabId, dropTarget.side);
    setDraggedTabId(null);
    setDropTarget(null);
  };

  const endDrag = (): void => {
    setDraggedTabId(null);
    setDropTarget(null);
  };

  return (
    <div className="object-tabs" role="tablist" aria-label="Open database objects">
      {objectsCollapsed ? (
        <button
          className="object-tabs-panel-toggle"
          type="button"
          title="Expand tables"
          aria-label="Expand tables"
          onClick={onExpandObjects}
        >
          <Table2 size={14} />
          <ChevronsRight size={13} />
        </button>
      ) : null}
      {tabs.length === 0 ? (
        <span className="object-tabs-empty">Open a table or view from the tables sidebar</span>
      ) : null}
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const dirty = isObjectTabDirty(tab);
        const dragging = draggedTabId === tab.id;
        const dropping = dropTarget?.tabId === tab.id ? `drop-${dropTarget.side}` : "";

        return (
          <div
            className={`object-tab ${active ? "active" : ""} ${tab.pinned ? "" : "preview"} ${
              dirty ? "dirty" : ""
            } ${dragging ? "dragging" : ""} ${dropping}`}
            key={tab.id}
            title={objectDisplayName(tab.object)}
          >
            <button
              aria-selected={active}
              className="object-tab-main"
              draggable
              role="tab"
              type="button"
              onDragEnd={endDrag}
              onDragLeave={() => setDropTarget(null)}
              onDragOver={(event) => updateDropTarget(tab.id, event)}
              onDragStart={(event) => {
                setDraggedTabId(tab.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tab.id);
              }}
              onDrop={(event) => dropTab(tab.id, event)}
              onClick={() => onFocus(tab.id)}
              onDoubleClick={() => onPin(tab.id)}
            >
              {isTableObject(tab.object) ? <Table2 size={13} /> : <Braces size={13} />}
              <span className="object-tab-label">{tab.object.name}</span>
              <span className="object-tab-meta">{tab.object.schema}</span>
              {dirty ? <span className="object-tab-dirty-dot" aria-hidden="true" /> : null}
            </button>
            <button
              className="object-tab-close"
              type="button"
              title={`Close ${objectDisplayName(tab.object)}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EmptyObjectPrompt(): ReactElement {
  return (
    <div className="empty-object-view">
      <p>Open a table or view from the tables sidebar.</p>
    </div>
  );
}

function ConnectionLoader({ profile }: { profile: ConnectionProfile | null }): ReactElement {
  return (
    <div className="connection-loader" role="status" aria-live="polite">
      <div className="connection-loader-panel">
        <Loader2 className="spin connection-loader-spinner" size={16} aria-hidden="true" />
        <div className="connection-loader-copy">
          <strong>Connecting</strong>
          <p>
            {profile ? `${profile.name || profile.database} / ${profileDisplayTarget(profile)}` : "Opening connection"}
          </p>
        </div>
      </div>
    </div>
  );
}

function TableDataView({
  appliedFilterCount,
  data,
  draftRows,
  draftFilters,
  filtersVisible,
  footerEnd,
  page,
  profileId,
  stagedRow,
  tableSort,
  onAddFilterRule,
  onApplyChanges,
  onApplyFilters,
  onCellChange,
  onCancelStagedRow,
  onClearFilters,
  onDeleteRow,
  onDeleteRows,
  onFilterRuleChange,
  onInsertRow,
  onOpenFilteredTab,
  onPageChange,
  onRemoveFilterRule,
  onRefresh,
  onResetChanges,
  onStageRow,
  onStagedRowChange,
  onSortChange,
  onToggleFilters
}: {
  appliedFilterCount: number;
  data: TableDataResult | null;
  draftRows: DraftRows;
  draftFilters: TableFilterInput;
  filtersVisible: boolean;
  footerEnd?: ReactNode;
  page: number;
  profileId: string;
  stagedRow: StagedRow | null;
  tableSort: TableSortInput | null;
  onAddFilterRule: () => void;
  onApplyChanges: (updates: DraftRowUpdate[], insertValues?: Record<string, unknown>) => void;
  onApplyFilters: () => void;
  onCellChange: (rowKey: string, column: string, value: string) => void;
  onCancelStagedRow: () => void;
  onClearFilters: () => void;
  onDeleteRow: (row: Record<string, unknown>) => void;
  onDeleteRows: (rows: Record<string, unknown>[]) => void;
  onFilterRuleChange: (ruleId: string, updates: Partial<TableFilterRule>) => void;
  onInsertRow: (values: Record<string, unknown>) => void;
  onOpenFilteredTab: (column: string, value: unknown) => void;
  onPageChange: (page: number) => void;
  onRemoveFilterRule: (ruleId: string) => void;
  onRefresh: () => void;
  onResetChanges: () => void;
  onStageRow: () => void;
  onStagedRowChange: (column: string, value: string) => void;
  onSortChange: (sort: TableSortInput | null) => void;
  onToggleFilters: () => void;
}): ReactElement {
  const canWrite = Boolean(data?.primaryKeys.length);
  const totalPages = data ? Math.max(1, Math.ceil(data.totalRows / data.pageSize)) : 1;
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenu | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenu | null>(null);
  const [rowEditor, setRowEditor] = useState<RowEditor | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteRowConfirmation | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(() => new Set());
  const [animatedSelectionRowKeys, setAnimatedSelectionRowKeys] = useState<Set<string>>(() => new Set());
  const [selectionAnchorRowKey, setSelectionAnchorRowKey] = useState<string | null>(null);
  const [rowKeyboardActive, setRowKeyboardActive] = useState(false);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [columnLayout, setColumnLayout] = useState<ColumnLayout>({ order: [], widths: {} });
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ColumnDropTarget | null>(null);
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const cellInputRefs = useRef(new Map<string, HTMLElement>());
  const copyStatusTimeoutRef = useRef<number | null>(null);
  const selectionAnimationTimeoutRef = useRef<number | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const rowElementRefs = useRef(new Map<string, HTMLTableRowElement>());
  const selectedRowKeyRef = useRef<string | null>(null);
  const selectedRowKeysRef = useRef<Set<string>>(new Set());
  const animatedSelectionRowKeysRef = useRef<Set<string>>(new Set());
  const selectionAnchorRowKeyRef = useRef<string | null>(null);
  const visibleClipboardRowsRef = useRef<ClipboardRow[]>([]);
  const rowIndexByKeyRef = useRef<Map<string, number>>(new Map());
  const columnNames = useMemo(() => data?.columns.map((column) => column.name) ?? [], [data]);
  const columnLookup = useMemo(() => new Map(data?.columns.map((column) => [column.name, column]) ?? []), [data]);
  const tableLayoutKey = data && profileId ? tableColumnLayoutStorageKey(profileId, data.schema, data.table) : null;
  const orderedColumns = useMemo(
    () =>
      reconcileColumnLayout(columnLayout, columnNames)
        .order.map((columnName) => columnLookup.get(columnName))
        .filter((column): column is TableColumn => Boolean(column)),
    [columnLayout, columnLookup, columnNames]
  );
  const stagedRowValues = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(stagedRow ?? {})
          .filter(([, value]) => value.trim() !== "")
          .map(([column, value]) => [column, parseCellInput(value)])
      ),
    [stagedRow]
  );
  const hasStagedRowValues = Object.keys(stagedRowValues).length > 0;
  const draftRowUpdates = useMemo(
    () =>
      data?.rows
        .map((row, index) => ({ row, rowKey: rowKeyFor(data.primaryKeys, row, index) }))
        .filter((update) => Boolean(draftRows[update.rowKey])) ?? [],
    [data, draftRows]
  );
  const hasPendingChanges = draftRowUpdates.length > 0 || hasStagedRowValues;
  const rowEditorDraft = rowEditor ? (draftRows[rowEditor.rowKey] ?? {}) : {};
  const rowEditorDirty = Boolean(rowEditor && draftRows[rowEditor.rowKey]);
  const visibleClipboardRows = useMemo<ClipboardRow[]>(() => {
    const rows: ClipboardRow[] = stagedRow ? [{ row: stagedRowValues, rowKey: "__staged__" }] : [];

    if (!data) {
      return rows;
    }

    return [
      ...rows,
      ...data.rows.map((row, index) => {
        const rowKey = rowKeyFor(data.primaryKeys, row, index);
        return {
          row: {
            ...row,
            ...(draftRows[rowKey] ?? {})
          },
          rowKey
        };
      })
    ];
  }, [data, draftRows, stagedRow, stagedRowValues]);
  const rowIndexByKey = useMemo(
    () => new Map(visibleClipboardRows.map((row, index) => [row.rowKey, index])),
    [visibleClipboardRows]
  );
  useEffect(() => {
    selectedRowKeyRef.current = selectedRowKey;
    selectedRowKeysRef.current = selectedRowKeys;
    selectionAnchorRowKeyRef.current = selectionAnchorRowKey;
    visibleClipboardRowsRef.current = visibleClipboardRows;
    rowIndexByKeyRef.current = rowIndexByKey;
  }, [rowIndexByKey, selectedRowKey, selectedRowKeys, selectionAnchorRowKey, visibleClipboardRows]);
  const selectedClipboardRows = useMemo(
    () => visibleClipboardRows.filter((row) => selectedRowKeys.has(row.rowKey)),
    [selectedRowKeys, visibleClipboardRows]
  );
  const selectedRowCount = selectedClipboardRows.length;
  const selectedExistingRows = useMemo(
    () => selectedClipboardRows.filter((row) => row.rowKey !== "__staged__").map((row) => row.row),
    [selectedClipboardRows]
  );

  useEffect(() => {
    if (!tableLayoutKey) {
      setColumnLayout({ order: [], widths: {} });
    } else {
      setColumnLayout(readColumnLayout(tableLayoutKey, columnNames));
    }
    setSelectedRowKey(null);
    setSelectedRowKeys(new Set());
    setAnimatedSelectionRowKeys(new Set());
    setSelectionAnchorRowKey(null);
    selectedRowKeyRef.current = null;
    selectedRowKeysRef.current = new Set();
    animatedSelectionRowKeysRef.current = new Set();
    selectionAnchorRowKeyRef.current = null;
    setRowKeyboardActive(false);
  }, [columnNames, tableLayoutKey]);

  useEffect(() => {
    if (!rowContextMenu) {
      return;
    }

    const closeContextMenu = (): void => setRowContextMenu(null);
    const closeContextMenuOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    };

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeContextMenuOnEscape);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenuOnEscape);
    };
  }, [rowContextMenu]);

  useEffect(() => {
    if (!cellContextMenu) {
      return;
    }

    const closeCellContextMenu = (): void => setCellContextMenu(null);
    const closeCellContextMenuOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeCellContextMenu();
      }
    };

    window.addEventListener("click", closeCellContextMenu);
    window.addEventListener("keydown", closeCellContextMenuOnEscape);

    return () => {
      window.removeEventListener("click", closeCellContextMenu);
      window.removeEventListener("keydown", closeCellContextMenuOnEscape);
    };
  }, [cellContextMenu]);

  useEffect(() => {
    return () => {
      if (copyStatusTimeoutRef.current !== null) {
        window.clearTimeout(copyStatusTimeoutRef.current);
      }
      if (selectionAnimationTimeoutRef.current !== null) {
        window.clearTimeout(selectionAnimationTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!rowEditor) {
      return;
    }

    const closeRowEditorOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setRowEditor(null);
      }
    };

    window.addEventListener("keydown", closeRowEditorOnEscape);

    return () => {
      window.removeEventListener("keydown", closeRowEditorOnEscape);
    };
  }, [rowEditor]);

  useEffect(() => {
    if (!deleteConfirmation) {
      return;
    }

    const closeDeleteConfirmationOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setDeleteConfirmation(null);
      }
    };

    window.addEventListener("keydown", closeDeleteConfirmationOnEscape);

    return () => {
      window.removeEventListener("keydown", closeDeleteConfirmationOnEscape);
    };
  }, [deleteConfirmation]);

  useEffect(() => {
    if (!rowEditor || !data) {
      return;
    }

    const rowIsVisible = data.rows.some((row, index) => rowKeyFor(data.primaryKeys, row, index) === rowEditor.rowKey);

    if (!rowIsVisible) {
      setRowEditor(null);
    }
  }, [data, rowEditor]);

  useEffect(() => {
    if (selectedRowKeys.size === 0) {
      return;
    }

    const visibleRowKeys = new Set(visibleClipboardRows.map((row) => row.rowKey));
    const nextSelectedRowKeys = [...selectedRowKeys].filter((rowKey) => visibleRowKeys.has(rowKey));

    if (nextSelectedRowKeys.length !== selectedRowKeys.size) {
      setSelectedRowKeys(new Set(nextSelectedRowKeys));
    }

    if (selectedRowKey && !visibleRowKeys.has(selectedRowKey)) {
      setSelectedRowKey(nextSelectedRowKeys.at(-1) ?? null);
    }

    if (selectionAnchorRowKey && !visibleRowKeys.has(selectionAnchorRowKey)) {
      setSelectionAnchorRowKey(nextSelectedRowKeys[0] ?? null);
    }

    if (nextSelectedRowKeys.length === 0) {
      setCopyStatus(null);
    }
  }, [selectedRowKey, selectedRowKeys, selectionAnchorRowKey, visibleClipboardRows]);

  useEffect(() => {
    if (!editingCell) {
      return;
    }

    window.requestAnimationFrame(() => {
      const input = cellInputRefs.current.get(cellInputKey(editingCell.rowKey, editingCell.columnName));
      input?.focus();
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.select();
      }
    });
  }, [editingCell]);

  const updateColumnLayout = useCallback(
    (updater: (current: ColumnLayout) => ColumnLayout): void => {
      setColumnLayout((current) => {
        const next = reconcileColumnLayout(updater(reconcileColumnLayout(current, columnNames)), columnNames);
        if (tableLayoutKey) {
          window.localStorage.setItem(tableLayoutKey, JSON.stringify(next));
        }
        return next;
      });
    },
    [columnNames, tableLayoutKey]
  );

  const columnWidth = (columnName: string): number => columnLayout.widths[columnName] ?? DEFAULT_COLUMN_WIDTH;

  const moveColumn = (sourceColumn: string, target: ColumnDropTarget): void => {
    if (sourceColumn === target.columnName) {
      return;
    }

    updateColumnLayout((current) => ({
      ...current,
      order: reorderColumn(current.order, sourceColumn, target.columnName, target.side)
    }));
  };

  const resizeColumn = (columnName: string, width: number): void => {
    updateColumnLayout((current) => ({
      ...current,
      widths: {
        ...current.widths,
        [columnName]: clampColumnWidth(width)
      }
    }));
  };

  const setRowElement = useCallback((rowKey: string, element: HTMLTableRowElement | null): void => {
    if (element) {
      rowElementRefs.current.set(rowKey, element);
      return;
    }

    rowElementRefs.current.delete(rowKey);
  }, []);

  const setCellInput = useCallback((rowKey: string, columnName: string, input: HTMLElement | null): void => {
    const inputKey = cellInputKey(rowKey, columnName);
    if (input) {
      cellInputRefs.current.set(inputKey, input);
      return;
    }

    cellInputRefs.current.delete(inputKey);
  }, []);

  const scrollRowIntoView = useCallback((rowKey: string): void => {
    window.requestAnimationFrame(() => {
      rowElementRefs.current.get(rowKey)?.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
    });
  }, []);

  const animateSelectionRows = useCallback((rowKeys: string[]): void => {
    if (selectionAnimationTimeoutRef.current !== null) {
      window.clearTimeout(selectionAnimationTimeoutRef.current);
      selectionAnimationTimeoutRef.current = null;
    }

    if (rowKeys.length === 0) {
      if (animatedSelectionRowKeysRef.current.size > 0) {
        const emptyRowKeys = new Set<string>();
        animatedSelectionRowKeysRef.current = emptyRowKeys;
        setAnimatedSelectionRowKeys(emptyRowKeys);
      }
      return;
    }

    const nextAnimatedRowKeys = new Set(rowKeys);
    animatedSelectionRowKeysRef.current = nextAnimatedRowKeys;
    setAnimatedSelectionRowKeys(nextAnimatedRowKeys);
    selectionAnimationTimeoutRef.current = window.setTimeout(() => {
      const emptyRowKeys = new Set<string>();
      animatedSelectionRowKeysRef.current = emptyRowKeys;
      setAnimatedSelectionRowKeys(emptyRowKeys);
      selectionAnimationTimeoutRef.current = null;
    }, 140);
  }, []);

  const selectSingleRow = useCallback(
    (rowKey: string): void => {
      if (
        selectedRowKeyRef.current === rowKey &&
        selectionAnchorRowKeyRef.current === rowKey &&
        selectedRowKeysRef.current.size === 1 &&
        selectedRowKeysRef.current.has(rowKey)
      ) {
        return;
      }

      animateSelectionRows([]);
      const nextSelectedRowKeys = new Set([rowKey]);
      selectedRowKeyRef.current = rowKey;
      selectedRowKeysRef.current = nextSelectedRowKeys;
      selectionAnchorRowKeyRef.current = rowKey;
      setSelectedRowKey(rowKey);
      setSelectionAnchorRowKey(rowKey);
      setSelectedRowKeys(nextSelectedRowKeys);
    },
    [animateSelectionRows]
  );

  const selectRowRange = useCallback(
    (targetRowKey: string): void => {
      const anchorRowKey = selectionAnchorRowKeyRef.current ?? selectedRowKeyRef.current ?? targetRowKey;
      const anchorIndex = rowIndexByKeyRef.current.get(anchorRowKey);
      const targetIndex = rowIndexByKeyRef.current.get(targetRowKey);

      if (anchorIndex === undefined || targetIndex === undefined) {
        selectSingleRow(targetRowKey);
        return;
      }

      const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      const nextSelectedRowKeys = new Set(
        visibleClipboardRowsRef.current.slice(start, end + 1).map((row) => row.rowKey)
      );
      const animatedRowKeys = [...nextSelectedRowKeys].filter((rowKey) => !selectedRowKeysRef.current.has(rowKey));
      if (selectedRowKeyRef.current === targetRowKey && setsEqual(selectedRowKeysRef.current, nextSelectedRowKeys)) {
        return;
      }

      animateSelectionRows(animatedRowKeys);
      selectedRowKeyRef.current = targetRowKey;
      selectedRowKeysRef.current = nextSelectedRowKeys;
      setSelectedRowKey(targetRowKey);
      setSelectedRowKeys(nextSelectedRowKeys);
    },
    [animateSelectionRows, selectSingleRow]
  );

  const selectRowFromEvent = useCallback(
    (rowKey: string, event: MouseEvent<HTMLTableRowElement> | PointerEvent<HTMLTableRowElement>): void => {
      setRowKeyboardActive(true);
      if (event.shiftKey) {
        selectRowRange(rowKey);
        return;
      }

      selectSingleRow(rowKey);
    },
    [selectRowRange, selectSingleRow]
  );

  const handleRowSelectionKeyDown = useCallback(
    (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      const visibleRows = visibleClipboardRowsRef.current;

      if (visibleRows.length === 0) {
        return;
      }

      event.preventDefault();
      const activeRowKey = selectedRowKeyRef.current;
      const activeIndex = activeRowKey ? (rowIndexByKeyRef.current.get(activeRowKey) ?? 0) : null;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex =
        activeIndex === null
          ? event.key === "ArrowDown"
            ? 0
            : visibleRows.length - 1
          : Math.min(visibleRows.length - 1, Math.max(0, activeIndex + direction));
      const nextRowKey = visibleRows[nextIndex].rowKey;

      if (event.shiftKey) {
        selectRowRange(nextRowKey);
        scrollRowIntoView(nextRowKey);
        return;
      }

      selectSingleRow(nextRowKey);
      scrollRowIntoView(nextRowKey);
    },
    [scrollRowIntoView, selectRowRange, selectSingleRow]
  );

  useEffect(() => {
    if (!rowKeyboardActive) {
      return;
    }

    const stopRowKeyboardNavigation = (event: globalThis.PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && tableRef.current?.contains(target)) {
        return;
      }

      setRowKeyboardActive(false);
    };

    window.addEventListener("keydown", handleRowSelectionKeyDown);
    window.addEventListener("pointerdown", stopRowKeyboardNavigation);

    return () => {
      window.removeEventListener("keydown", handleRowSelectionKeyDown);
      window.removeEventListener("pointerdown", stopRowKeyboardNavigation);
    };
  }, [handleRowSelectionKeyDown, rowKeyboardActive]);

  const openRowContextMenu = useCallback(
    (row: Record<string, unknown>, rowKey: string, event: MouseEvent<HTMLTableRowElement>): void => {
      event.preventDefault();
      if (!selectedRowKeysRef.current.has(rowKey)) {
        selectSingleRow(rowKey);
      }
      setRowKeyboardActive(true);
      setCellContextMenu(null);
      setRowContextMenu({
        type: "existing",
        row,
        rowKey,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 410)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 286))
      });
    },
    [selectSingleRow]
  );

  const openStagedRowContextMenu = (event: MouseEvent<HTMLTableRowElement>): void => {
    event.preventDefault();
    if (!selectedRowKeys.has("__staged__")) {
      selectSingleRow("__staged__");
    }
    setRowKeyboardActive(true);
    setCellContextMenu(null);
    setRowContextMenu({
      type: "staged",
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 410)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 286))
    });
  };

  const openExistingCellMenu = useCallback(
    (row: Record<string, unknown>, rowKey: string, column: TableColumn, event: MouseEvent<HTMLElement>): void => {
      event.preventDefault();
      event.stopPropagation();
      selectSingleRow(rowKey);
      setRowKeyboardActive(true);
      setRowContextMenu(null);
      setCellContextMenu({
        type: "existing",
        row,
        rowKey,
        column,
        value: row[column.name],
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 340)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360))
      });
    },
    [selectSingleRow]
  );

  const openStagedCellMenu = (column: TableColumn, event: MouseEvent<HTMLElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    selectSingleRow("__staged__");
    setRowKeyboardActive(true);
    setRowContextMenu(null);
    setCellContextMenu({
      type: "staged",
      column,
      value: stagedRow?.[column.name] ?? "",
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 340)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 360))
    });
  };

  const setCellMenuValue = (value: string): void => {
    if (!cellContextMenu) {
      return;
    }

    if (cellContextMenu.type === "staged") {
      onStagedRowChange(cellContextMenu.column.name, value);
    } else {
      onCellChange(cellContextMenu.rowKey, cellContextMenu.column.name, value);
    }

    setCellContextMenu(null);
  };

  const openPrimaryKeyFilteredTab = (): void => {
    if (cellContextMenu?.type !== "existing") {
      return;
    }

    onOpenFilteredTab(cellContextMenu.column.name, cellContextMenu.value);
    setCellContextMenu(null);
  };

  const editRow = (row: Record<string, unknown>, rowKey: string): void => {
    if (!canWrite) {
      return;
    }

    selectSingleRow(rowKey);
    setRowEditor({ row, rowKey });
  };

  const editCell = useCallback(
    (rowKey: string, columnName: string): void => {
      if (!canWrite) {
        return;
      }

      selectSingleRow(rowKey);
      setEditingCell({ rowKey, columnName });
    },
    [canWrite, selectSingleRow]
  );

  const requestDeleteRows = (rows: Record<string, unknown>[]): void => {
    if (!canWrite) {
      return;
    }

    setRowContextMenu(null);
    setDeleteConfirmation({ rows });
  };

  const confirmDeleteRow = (): void => {
    if (!deleteConfirmation) {
      return;
    }

    const rows = deleteConfirmation.rows;
    setDeleteConfirmation(null);
    if (rows.length === 1) {
      onDeleteRow(rows[0]);
      return;
    }

    onDeleteRows(rows);
  };

  const startColumnDrag = (columnName: string, event: DragEvent<HTMLTableCellElement>): void => {
    if (resizingColumn) {
      event.preventDefault();
      return;
    }

    if (event.target instanceof HTMLElement && event.target.closest(".column-sort-button")) {
      event.preventDefault();
      return;
    }

    setDraggedColumn(columnName);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", columnName);
  };

  const updateColumnDropTarget = (columnName: string, event: DragEvent<HTMLTableCellElement>): void => {
    const sourceColumn = draggedColumn || event.dataTransfer.getData("text/plain");
    if (!sourceColumn || sourceColumn === columnName) {
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const side = event.clientX < rect.left + rect.width / 2 ? "before" : "after";
    setDropTarget({ columnName, side });
  };

  const dropColumn = (columnName: string, event: DragEvent<HTMLTableCellElement>): void => {
    const sourceColumn = draggedColumn || event.dataTransfer.getData("text/plain");
    if (!sourceColumn || !dropTarget) {
      setDraggedColumn(null);
      setDropTarget(null);
      return;
    }

    event.preventDefault();
    moveColumn(sourceColumn, dropTarget.columnName === columnName ? dropTarget : { columnName, side: "before" });
    setDraggedColumn(null);
    setDropTarget(null);
  };

  const endColumnDrag = (): void => {
    setDraggedColumn(null);
    setDropTarget(null);
  };

  const startColumnResize = (columnName: string, event: PointerEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidth = columnWidth(columnName);
    setResizingColumn(columnName);

    const handlePointerMove = (moveEvent: globalThis.PointerEvent): void => {
      resizeColumn(columnName, startWidth + moveEvent.clientX - startX);
    };
    const handlePointerUp = (): void => {
      setResizingColumn(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  };

  const autosizeColumn = (column: TableColumn, event: MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault();
    event.stopPropagation();

    if (!data) {
      return;
    }

    const visibleValues = data.rows.map((row, index) => {
      const rowKey = rowKeyFor(data.primaryKeys, row, index);
      const draftValue = draftRows[rowKey]?.[column.name];
      return formatCell(Object.hasOwn(draftRows[rowKey] ?? {}, column.name) ? draftValue : row[column.name]);
    });
    const stagedValue = stagedRow?.[column.name] ? [stagedRow[column.name]] : [];
    resizeColumn(column.name, autosizeColumnWidth([column.name, column.dataType, ...visibleValues, ...stagedValue]));
  };

  const toggleColumnSort = (columnName: string): void => {
    if (hasPendingChanges) {
      return;
    }

    onSortChange(nextTableSort(tableSort, columnName));
    setSelectedRowKey(null);
    setSelectedRowKeys(new Set());
    setSelectionAnchorRowKey(null);
    setRowKeyboardActive(false);
  };

  const applyPendingChanges = (): void => {
    onApplyChanges(draftRowUpdates, hasStagedRowValues ? stagedRowValues : undefined);
    setRowEditor(null);
    setEditingCell(null);
  };

  const applyRowEditorChanges = (): void => {
    if (!rowEditor || !rowEditorDirty) {
      return;
    }

    onApplyChanges([{ row: rowEditor.row, rowKey: rowEditor.rowKey }]);
    setRowEditor(null);
    setEditingCell(null);
  };

  const undoPendingChanges = (): void => {
    setRowContextMenu(null);
    setCellContextMenu(null);
    setRowEditor(null);
    setDeleteConfirmation(null);
    setEditingCell(null);
    setSelectedRowKey(null);
    setSelectedRowKeys(new Set());
    setSelectionAnchorRowKey(null);
    setRowKeyboardActive(false);
    onResetChanges();
  };

  const showCopyStatus = (message: string): void => {
    setCopyStatus(message);

    if (copyStatusTimeoutRef.current !== null) {
      window.clearTimeout(copyStatusTimeoutRef.current);
    }
    copyStatusTimeoutRef.current = window.setTimeout(() => setCopyStatus(null), 1600);
  };

  const copyRows = async (format: ClipboardRowFormat, clipboardRows = selectedClipboardRows): Promise<void> => {
    if (!data || clipboardRows.length === 0) {
      return;
    }

    const label = COPY_ROW_FORMATS.find((item) => item.format === format)?.label ?? "row";
    const content = formatRowsForClipboard(format, {
      columns: orderedColumns.map((column) => column.name),
      rows: clipboardRows.map((clipboardRow) => clipboardRow.row),
      schema: data.schema,
      table: data.table
    });

    setRowContextMenu(null);

    try {
      await writeClipboardText(content);
      showCopyStatus(clipboardRows.length === 1 ? `${label} copied` : `${clipboardRows.length} rows copied`);
    } catch {
      showCopyStatus("Copy failed");
    }
  };
  const contextMenuUsesSelection =
    rowContextMenu?.type === "existing" && selectedRowKeys.has(rowContextMenu.rowKey) && selectedRowCount > 1;
  const contextMenuRowsToDelete =
    rowContextMenu?.type === "existing" ? (contextMenuUsesSelection ? selectedExistingRows : [rowContextMenu.row]) : [];

  return (
    <div className="data-view">
      <div className="panel-toolbar">
        <div>
          <strong>{data ? `${data.schema}.${data.table}` : "Data"}</strong>
          <span>
            {data
              ? selectedRowCount > 0
                ? `${data.totalRows.toLocaleString()} rows - ${selectedRowCount.toLocaleString()} selected`
                : `${data.totalRows.toLocaleString()} rows`
              : ""}
          </span>
        </div>
        <div className="button-row">
          <button
            className="icon-button"
            type="button"
            title="Previous page"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            <ChevronsLeft size={15} />
          </button>
          <span className="page-label">
            {page} / {totalPages}
          </span>
          <button
            className="icon-button"
            type="button"
            title="Next page"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            <ChevronsRight size={15} />
          </button>
          <button className="icon-button" type="button" title="Refresh table" onClick={onRefresh}>
            <RefreshCcw size={15} />
          </button>
          {copyStatus ? <span className="copy-status-label">{copyStatus}</span> : null}
        </div>
      </div>

      {filtersVisible ? (
        <FilterToolbar
          columns={orderedColumns}
          disabled={hasPendingChanges}
          filters={draftFilters}
          onAddRule={onAddFilterRule}
          onApply={onApplyFilters}
          onChangeRule={onFilterRuleChange}
          onClear={onClearFilters}
          onRemoveRule={onRemoveFilterRule}
        />
      ) : null}

      <div className="table-scroll">
        <table className="data-grid" ref={tableRef} aria-label="Table rows">
          <colgroup>
            {orderedColumns.map((column) => (
              <col key={column.name} style={{ width: columnWidth(column.name) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {orderedColumns.map((column) => {
                const activeDirection = tableSort?.column === column.name ? tableSort.direction : null;
                const SortIcon =
                  activeDirection === "asc" ? ArrowUp : activeDirection === "desc" ? ArrowDown : ArrowUpDown;
                const nextSort = nextTableSort(tableSort, column.name);
                const sortTitle = hasPendingChanges
                  ? "Apply or undo row changes before sorting"
                  : nextSort
                    ? `Sort ${column.name} ${nextSort.direction === "asc" ? "ascending" : "descending"}`
                    : `Clear ${column.name} sorting`;

                return (
                  <th
                    className={`column-header ${draggedColumn === column.name ? "dragging" : ""} ${
                      dropTarget?.columnName === column.name ? `drop-${dropTarget.side}` : ""
                    } ${resizingColumn === column.name ? "resizing" : ""}`}
                    draggable={!resizingColumn}
                    key={column.name}
                    onDragEnd={endColumnDrag}
                    onDragLeave={() => setDropTarget(null)}
                    onDragOver={(event) => updateColumnDropTarget(column.name, event)}
                    onDragStart={(event) => startColumnDrag(column.name, event)}
                    onDrop={(event) => dropColumn(column.name, event)}
                  >
                    <div className="column-header-content">
                      <span className="column-title">
                        <span>{column.name}</span>
                        <small>{column.dataType}</small>
                      </span>
                      <button
                        className={`column-sort-button ${activeDirection ? `active ${activeDirection}` : ""}`}
                        type="button"
                        title={sortTitle}
                        aria-label={sortTitle}
                        aria-pressed={Boolean(activeDirection)}
                        disabled={hasPendingChanges}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleColumnSort(column.name);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <SortIcon size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <button
                      className="column-resize-handle"
                      type="button"
                      title="Drag to resize. Double-click to fit visible content."
                      aria-label={`Resize ${column.name}`}
                      onDoubleClick={(event) => autosizeColumn(column, event)}
                      onPointerDown={(event) => startColumnResize(column.name, event)}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {stagedRow ? (
              <tr
                className={`staged-row ${selectedRowKeys.has("__staged__") ? "selected-row" : ""} ${
                  selectedRowKey === "__staged__" ? "active-row" : ""
                } ${animatedSelectionRowKeys.has("__staged__") ? "selection-enter-row" : ""}`}
                ref={(element) => setRowElement("__staged__", element)}
                onPointerDown={(event) => {
                  if (event.button === 0) {
                    selectRowFromEvent("__staged__", event);
                  }
                }}
                onContextMenu={openStagedRowContextMenu}
              >
                {orderedColumns.map((column) => (
                  <td key={column.name}>
                    <div className="data-cell-editor">
                      <CellValueEditor
                        column={column}
                        placeholder={column.name}
                        value={stagedRow[column.name] ?? ""}
                        onChange={(nextValue) => onStagedRowChange(column.name, nextValue)}
                      />
                      <button
                        className="data-cell-menu-button"
                        type="button"
                        title={`Cell options for ${column.name}`}
                        aria-label={`Cell options for ${column.name}`}
                        onClick={(event) => openStagedCellMenu(column, event)}
                      >
                        <ChevronsUpDown size={13} />
                      </button>
                    </div>
                  </td>
                ))}
              </tr>
            ) : null}
            {data?.rows.map((row, index) => {
              const rowKey = rowKeyFor(data.primaryKeys, row, index);
              return (
                <MemoizedTableDataRow
                  canWrite={canWrite}
                  draftForRow={draftRows[rowKey] ?? EMPTY_DRAFT_ROW}
                  editingCell={editingCell}
                  key={rowKey}
                  orderedColumns={orderedColumns}
                  primaryKeys={data.primaryKeys}
                  row={row}
                  rowKey={rowKey}
                  selected={selectedRowKeys.has(rowKey)}
                  active={selectedRowKey === rowKey}
                  animateSelection={animatedSelectionRowKeys.has(rowKey)}
                  onCellChange={onCellChange}
                  onCellMenu={openExistingCellMenu}
                  onContextMenu={openRowContextMenu}
                  onEditCell={editCell}
                  onOpenFilteredTab={onOpenFilteredTab}
                  onRowPointerDown={selectRowFromEvent}
                  setCellInput={setCellInput}
                  setRowElement={setRowElement}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {rowContextMenu ? (
        <div
          className="context-menu"
          style={{
            left: rowContextMenu.x,
            top: rowContextMenu.y
          }}
        >
          {rowContextMenu.type === "staged" ? (
            <>
              <CopyRowSubmenu
                disabled={!hasStagedRowValues}
                selectedRowCount={1}
                onCopy={(format) => void copyRows(format, [{ row: stagedRowValues, rowKey: "__staged__" }])}
              />
              <div className="context-menu-separator" />
              <button
                type="button"
                onClick={() => {
                  setRowContextMenu(null);
                  onInsertRow(stagedRowValues);
                }}
                disabled={!hasStagedRowValues}
              >
                <Save size={14} />
                Insert row
              </button>
              <button
                className="danger"
                type="button"
                onClick={() => {
                  setRowContextMenu(null);
                  onCancelStagedRow();
                }}
              >
                <Trash2 size={14} />
                Discard row
              </button>
            </>
          ) : (
            <>
              <CopyRowSubmenu
                selectedRowCount={contextMenuUsesSelection ? selectedRowCount : 1}
                onCopy={(format) =>
                  void copyRows(
                    format,
                    selectedRowKeys.has(rowContextMenu.rowKey)
                      ? selectedClipboardRows
                      : [
                          {
                            row: {
                              ...rowContextMenu.row,
                              ...(draftRows[rowContextMenu.rowKey] ?? {})
                            },
                            rowKey: rowContextMenu.rowKey
                          }
                        ]
                  )
                }
              />
              <div className="context-menu-separator" />
              {contextMenuUsesSelection ? null : (
                <button
                  type="button"
                  onClick={() => {
                    const row = rowContextMenu.row;
                    const rowKey = rowContextMenu.rowKey;
                    setRowContextMenu(null);
                    editRow(row, rowKey);
                  }}
                  disabled={!canWrite}
                >
                  <Pencil size={14} />
                  Edit row
                </button>
              )}
              <button
                className="danger"
                type="button"
                onClick={() => {
                  requestDeleteRows(contextMenuRowsToDelete);
                }}
                disabled={!canWrite || contextMenuRowsToDelete.length === 0}
              >
                <Trash2 size={14} />
                {contextMenuRowsToDelete.length > 1
                  ? `Delete ${contextMenuRowsToDelete.length.toLocaleString()} rows`
                  : "Delete row"}
              </button>
            </>
          )}
        </div>
      ) : null}

      {cellContextMenu ? (
        <CellContextMenuPanel
          canWrite={canWrite}
          menu={cellContextMenu}
          onOpenFilteredTab={openPrimaryKeyFilteredTab}
          onSetValue={setCellMenuValue}
        />
      ) : null}

      {rowEditor && data ? (
        <div className="row-drawer-backdrop">
          <aside className="row-drawer" aria-label="Edit row">
            <header>
              <div>
                <strong>Edit row</strong>
                <span>{`${data.schema}.${data.table}`}</span>
              </div>
              <button className="icon-button" type="button" title="Close editor" onClick={() => setRowEditor(null)}>
                <X size={16} />
              </button>
            </header>

            <div className="row-drawer-fields">
              {orderedColumns.map((column) => {
                const changed = Object.hasOwn(rowEditorDraft, column.name);
                const value = formatCell(changed ? rowEditorDraft[column.name] : rowEditor.row[column.name]);
                return (
                  <label className={`row-drawer-field ${changed ? "dirty" : ""}`} key={column.name}>
                    <span>
                      <strong>{column.name}</strong>
                      <small>{column.dataType}</small>
                    </span>
                    <textarea
                      rows={value.includes("\n") ? 5 : 2}
                      value={value}
                      onChange={(event) => onCellChange(rowEditor.rowKey, column.name, event.target.value)}
                    />
                  </label>
                );
              })}
            </div>

            <footer>
              <button className="button secondary" type="button" onClick={() => setRowEditor(null)}>
                Close
              </button>
              <button
                className="button primary"
                type="button"
                onClick={applyRowEditorChanges}
                disabled={!rowEditorDirty}
              >
                <Save size={15} />
                Save row
              </button>
            </footer>
          </aside>
        </div>
      ) : null}

      {deleteConfirmation && data ? (
        <DeleteRowConfirmationDialog
          rows={deleteConfirmation.rows}
          primaryKeys={data.primaryKeys}
          tableName={`${data.schema}.${data.table}`}
          onCancel={() => setDeleteConfirmation(null)}
          onConfirm={confirmDeleteRow}
        />
      ) : null}

      <div className="insert-row">
        <div className="insert-row-actions">
          <button
            className="button primary"
            type="button"
            title={stagedRow ? "Undo new row" : "Add row"}
            aria-pressed={Boolean(stagedRow)}
            onClick={stagedRow ? onCancelStagedRow : onStageRow}
            disabled={!data}
          >
            <Plus size={15} />
            Row
          </button>
          <button
            className={`button secondary ${filtersVisible ? "active" : ""}`}
            type="button"
            onClick={onToggleFilters}
            disabled={!data}
          >
            <SlidersHorizontal size={15} />
            {appliedFilterCount ? `Filters (${appliedFilterCount})` : "Filters"}
          </button>
        </div>
        {hasPendingChanges ? (
          <div className="insert-row-actions">
            <button className="button secondary" type="button" onClick={applyPendingChanges}>
              <Save size={15} />
              Apply changes
            </button>
            <button className="button secondary" type="button" onClick={undoPendingChanges}>
              <RefreshCcw size={15} />
              Undo changes
            </button>
          </div>
        ) : null}
        {footerEnd ? <div className="insert-row-end">{footerEnd}</div> : null}
      </div>
    </div>
  );
}

type TableDataRowProps = {
  active: boolean;
  animateSelection: boolean;
  canWrite: boolean;
  draftForRow: Record<string, unknown>;
  editingCell: EditingCell | null;
  orderedColumns: TableColumn[];
  primaryKeys: string[];
  row: Record<string, unknown>;
  rowKey: string;
  selected: boolean;
  onCellChange: (rowKey: string, column: string, value: string) => void;
  onCellMenu: (
    row: Record<string, unknown>,
    rowKey: string,
    column: TableColumn,
    event: MouseEvent<HTMLElement>
  ) => void;
  onContextMenu: (row: Record<string, unknown>, rowKey: string, event: MouseEvent<HTMLTableRowElement>) => void;
  onEditCell: (rowKey: string, columnName: string) => void;
  onOpenFilteredTab: (column: string, value: unknown) => void;
  onRowPointerDown: (rowKey: string, event: PointerEvent<HTMLTableRowElement>) => void;
  setCellInput: (rowKey: string, columnName: string, input: HTMLElement | null) => void;
  setRowElement: (rowKey: string, element: HTMLTableRowElement | null) => void;
};

const MemoizedTableDataRow = memo(function TableDataRow({
  active,
  animateSelection,
  canWrite,
  draftForRow,
  editingCell,
  orderedColumns,
  primaryKeys,
  row,
  rowKey,
  selected,
  onCellChange,
  onCellMenu,
  onContextMenu,
  onEditCell,
  onOpenFilteredTab,
  onRowPointerDown,
  setCellInput,
  setRowElement
}: TableDataRowProps): ReactElement {
  const dirty = draftForRow !== EMPTY_DRAFT_ROW;
  const mergedRow = dirty ? { ...row, ...draftForRow } : row;

  return (
    <tr
      className={`${selected ? "selected-row" : ""} ${active ? "active-row" : ""} ${
        animateSelection ? "selection-enter-row" : ""
      } ${dirty ? "dirty-row" : ""}`}
      ref={(element) => setRowElement(rowKey, element)}
      onPointerDown={(event) => {
        if (event.button === 0) {
          onRowPointerDown(rowKey, event);
        }
      }}
      onContextMenu={(event) => onContextMenu(row, rowKey, event)}
    >
      {orderedColumns.map((column) => {
        const changed = Object.hasOwn(draftForRow, column.name);
        const editing = editingCell?.rowKey === rowKey && editingCell.columnName === column.name;
        const rawValue = changed ? draftForRow[column.name] : row[column.name];
        const value = formatCell(rawValue);
        const isPrimaryKey = primaryKeys.includes(column.name);

        return (
          <td className={changed ? "dirty-cell" : ""} key={column.name}>
            {editing ? (
              <div className="data-cell-editor">
                <CellValueEditor
                  column={column}
                  disabled={!canWrite}
                  inputRef={(input) => setCellInput(rowKey, column.name, input)}
                  value={value}
                  onChange={(nextValue) => onCellChange(rowKey, column.name, nextValue)}
                />
                <button
                  className="data-cell-menu-button"
                  type="button"
                  title={`Cell options for ${column.name}`}
                  aria-label={`Cell options for ${column.name}`}
                  onClick={(event) => onCellMenu(mergedRow, rowKey, column, event)}
                >
                  <ChevronsUpDown size={13} />
                </button>
              </div>
            ) : (
              <div className="data-cell-content">
                {isPrimaryKey ? (
                  <button
                    className="data-cell-key-button"
                    type="button"
                    title={`Open ${column.name} in a filtered tab`}
                    aria-label={`Open ${column.name} in a filtered tab`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenFilteredTab(column.name, rawValue);
                    }}
                  >
                    <KeyRound size={12} />
                  </button>
                ) : null}
                <button
                  className="data-cell-value"
                  type="button"
                  title="Double-click to edit this field"
                  aria-disabled={!canWrite}
                  onDoubleClick={() => onEditCell(rowKey, column.name)}
                >
                  {value}
                </button>
                <button
                  className="data-cell-menu-button"
                  type="button"
                  title={`Cell options for ${column.name}`}
                  aria-label={`Cell options for ${column.name}`}
                  onClick={(event) => onCellMenu(mergedRow, rowKey, column, event)}
                >
                  <ChevronsUpDown size={13} />
                </button>
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}, tableDataRowPropsAreEqual);

function tableDataRowPropsAreEqual(previous: TableDataRowProps, next: TableDataRowProps): boolean {
  const previousEditingColumn =
    previous.editingCell?.rowKey === previous.rowKey ? previous.editingCell.columnName : null;
  const nextEditingColumn = next.editingCell?.rowKey === next.rowKey ? next.editingCell.columnName : null;

  return (
    previous.active === next.active &&
    previous.animateSelection === next.animateSelection &&
    previous.canWrite === next.canWrite &&
    previous.draftForRow === next.draftForRow &&
    previous.orderedColumns === next.orderedColumns &&
    previous.primaryKeys === next.primaryKeys &&
    previous.row === next.row &&
    previous.rowKey === next.rowKey &&
    previous.selected === next.selected &&
    previousEditingColumn === nextEditingColumn &&
    previous.onCellChange === next.onCellChange &&
    previous.onCellMenu === next.onCellMenu &&
    previous.onContextMenu === next.onContextMenu &&
    previous.onEditCell === next.onEditCell &&
    previous.onOpenFilteredTab === next.onOpenFilteredTab &&
    previous.onRowPointerDown === next.onRowPointerDown &&
    previous.setCellInput === next.setCellInput &&
    previous.setRowElement === next.setRowElement
  );
}

function CellValueEditor({
  column,
  disabled,
  inputRef,
  placeholder,
  value,
  onChange
}: {
  column: TableColumn;
  disabled?: boolean;
  inputRef?: (input: HTMLElement | null) => void;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const dateInputType = dateControlType(column);
  const enumValues = tableColumnEnumValues(column);

  if (enumValues.length) {
    return (
      <select disabled={disabled} ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)}>
        {!enumValues.includes(value) ? <option value={value}>{value || "Empty"}</option> : null}
        {enumValues.map((enumValue) => (
          <option key={enumValue} value={enumValue}>
            {enumValue}
          </option>
        ))}
      </select>
    );
  }

  if (isBooleanColumn(column)) {
    return (
      <select
        disabled={disabled}
        ref={inputRef}
        value={booleanEditorValue(value)}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="true">true</option>
        <option value="false">false</option>
        <option value="null">NULL</option>
      </select>
    );
  }

  if (dateInputType) {
    return (
      <input
        disabled={disabled}
        placeholder={placeholder}
        ref={inputRef}
        step={dateInputType === "date" ? undefined : 1}
        type={dateInputType}
        value={dateEditorValue(value, dateInputType)}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      disabled={disabled}
      placeholder={placeholder}
      ref={inputRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function CellContextMenuPanel({
  canWrite,
  menu,
  onOpenFilteredTab,
  onSetValue
}: {
  canWrite: boolean;
  menu: CellContextMenu;
  onOpenFilteredTab: () => void;
  onSetValue: (value: string) => void;
}): ReactElement {
  const column = menu.column;
  const enumValues = tableColumnEnumValues(column);
  const dateInputType = dateControlType(column);
  const canUseNow = Boolean(dateInputType);
  const isExistingPrimaryKey = menu.type === "existing" && column.isPrimaryKey;
  const hasCellSpecificActions =
    isExistingPrimaryKey || Boolean(dateInputType) || (canWrite && (isBooleanColumn(column) || enumValues.length > 0));

  return (
    <div
      className="context-menu cell-context-menu"
      style={{
        left: menu.x,
        top: menu.y
      }}
    >
      {isExistingPrimaryKey ? (
        <button type="button" onClick={onOpenFilteredTab}>
          <ExternalLink size={14} />
          Open filtered tab
        </button>
      ) : null}

      {dateInputType ? (
        <label className="cell-context-field">
          <span>{dateInputType === "date" ? "Date" : dateInputType === "time" ? "Time" : "Date and time"}</span>
          <input
            step={dateInputType === "date" ? undefined : 1}
            type={dateInputType}
            value={dateEditorValue(formatCell(menu.value), dateInputType)}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => onSetValue(event.target.value)}
            disabled={!canWrite}
          />
        </label>
      ) : null}

      {canWrite && isBooleanColumn(column) ? (
        <div className="context-submenu">
          <button className="context-submenu-trigger" type="button" disabled={!canWrite}>
            <ToggleLeft size={14} />
            Boolean
            <ChevronRight className="context-submenu-arrow" size={14} />
          </button>
          <div className="context-submenu-panel">
            <button type="button" onClick={() => onSetValue("true")}>
              true
            </button>
            <button type="button" onClick={() => onSetValue("false")}>
              false
            </button>
          </div>
        </div>
      ) : null}

      {canWrite && enumValues.length ? (
        <div className="context-submenu">
          <button className="context-submenu-trigger" type="button" disabled={!canWrite}>
            <ListChecks size={14} />
            Enum
            <ChevronRight className="context-submenu-arrow" size={14} />
          </button>
          <div className="context-submenu-panel enum-submenu">
            {enumValues.map((enumValue) => (
              <button key={enumValue} type="button" title={enumValue} onClick={() => onSetValue(enumValue)}>
                {enumValue}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {hasCellSpecificActions ? <div className="context-menu-separator" /> : null}
      {column.nullable ? (
        <button type="button" onClick={() => onSetValue("null")} disabled={!canWrite}>
          <Minus size={14} />
          NULL
        </button>
      ) : null}
      <button type="button" onClick={() => onSetValue("")} disabled={!canWrite}>
        <Minus size={14} />
        Empty
      </button>
      {canUseNow ? (
        <button type="button" onClick={() => onSetValue(nowCellValue(column))} disabled={!canWrite}>
          <FileClock size={14} />
          NOW()
        </button>
      ) : null}
    </div>
  );
}

function FilterToolbar({
  columns,
  disabled,
  filters,
  onAddRule,
  onApply,
  onChangeRule,
  onClear,
  onRemoveRule
}: {
  columns: TableColumn[];
  disabled: boolean;
  filters: TableFilterInput;
  onAddRule: () => void;
  onApply: () => void;
  onChangeRule: (ruleId: string, updates: Partial<TableFilterRule>) => void;
  onClear: () => void;
  onRemoveRule: (ruleId: string) => void;
}): ReactElement {
  return (
    <div className="filter-toolbar">
      <div className="filter-toolbar-header">
        <strong>Filters</strong>
        <span>{disabled ? "Apply or undo row changes before filtering" : "Rules are applied to the database"}</span>
        <div className="filter-actions">
          <button className="button secondary" type="button" onClick={onClear} disabled={disabled}>
            Clear
          </button>
          <button className="button primary" type="button" onClick={onApply} disabled={disabled}>
            Apply
          </button>
          <button className="icon-button" type="button" title="Add filter" onClick={onAddRule} disabled={disabled}>
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="filter-rules">
        {filters.rules.length === 0 ? <p className="filter-empty">No filters</p> : null}
        {filters.rules.map((rule) => {
          const operatorRequiresValue = filterOperatorRequiresValue(rule.operator);
          const operatorOptions = TABLE_FILTER_OPERATORS.filter(
            (option) => rule.column !== null || ANY_COLUMN_FILTER_OPERATORS.has(option.operator)
          );
          const valuePlaceholder = rule.operator === "in" || rule.operator === "notIn" ? "value, value" : "Value";

          return (
            <div className="filter-row" key={rule.id}>
              <label className="filter-row-enabled" title="Enable filter">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(event) => onChangeRule(rule.id, { enabled: event.target.checked })}
                  disabled={disabled}
                />
              </label>
              <select
                className="filter-select"
                value={rule.column ?? "__any__"}
                onChange={(event) => {
                  const column = event.target.value === "__any__" ? null : event.target.value;
                  onChangeRule(rule.id, {
                    column,
                    operator:
                      column === null && !ANY_COLUMN_FILTER_OPERATORS.has(rule.operator) ? "contains" : rule.operator
                  });
                }}
                disabled={disabled}
              >
                <option value="__any__">Any column</option>
                {columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <select
                className="filter-select"
                value={rule.operator}
                onChange={(event) => onChangeRule(rule.id, { operator: event.target.value as TableFilterOperator })}
                disabled={disabled}
              >
                {operatorOptions.map((option) => (
                  <option key={option.operator} value={option.operator}>
                    {option.label}
                  </option>
                ))}
              </select>
              {operatorRequiresValue ? (
                <input
                  className="filter-input"
                  value={rule.value}
                  placeholder={valuePlaceholder}
                  onChange={(event) => onChangeRule(rule.id, { value: event.target.value })}
                  disabled={disabled}
                />
              ) : (
                <span className="filter-input filter-input-empty">No value</span>
              )}
              <button
                className="icon-button"
                type="button"
                title="Remove filter"
                onClick={() => onRemoveRule(rule.id)}
                disabled={disabled}
              >
                <Minus size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QueryView({
  activeSavedQueryId,
  connectedDatabase,
  savedQueryName,
  sqlText,
  result,
  theme,
  onChange,
  onExecute,
  onSavedQueryNameChange,
  onSave,
  onSaveAsNew,
  onShowSaved
}: {
  activeSavedQueryId: string | null;
  connectedDatabase: boolean;
  savedQueryName: string;
  sqlText: string;
  result: QueryExecutionResult | null;
  theme: ResolvedTheme;
  onChange: (value: string) => void;
  onExecute: () => void;
  onSavedQueryNameChange: (value: string) => void;
  onSave: () => void;
  onSaveAsNew: () => void;
  onShowSaved: () => void;
}): ReactElement {
  return (
    <div className="query-view">
      <div className="panel-toolbar">
        <strong>{activeSavedQueryId && savedQueryName ? savedQueryName : "SQL"}</strong>
        <div className="query-toolbar-actions">
          <input
            className="query-name-input"
            value={savedQueryName}
            placeholder="Query name"
            disabled={!connectedDatabase}
            onChange={(event) => onSavedQueryNameChange(event.target.value)}
          />
          <button className="button secondary" type="button" onClick={onSaveAsNew} disabled={!connectedDatabase}>
            <Plus size={15} />
            Save new
          </button>
          <button className="button secondary" type="button" onClick={onSave} disabled={!connectedDatabase}>
            <Save size={15} />
            Save
          </button>
          <button className="button secondary" type="button" onClick={onShowSaved} disabled={!connectedDatabase}>
            <Folder size={15} />
            Saved
          </button>
          <button className="button primary" type="button" onClick={onExecute}>
            <Play size={15} />
            Run
          </button>
        </div>
      </div>
      <CodeMirror
        className="sql-editor"
        value={sqlText}
        height="220px"
        theme={theme}
        extensions={[sql()]}
        onChange={onChange}
        basicSetup={{
          foldGutter: true,
          lineNumbers: true,
          highlightActiveLine: true
        }}
      />

      <div className="query-result">
        <div className="result-meta">
          <strong>{result ? `${result.command} in ${result.durationMs}ms` : "Result"}</strong>
          <span>{result?.notice ?? (result ? `${result.rowCount ?? result.rows.length} rows` : "")}</span>
        </div>
        <ResultTable rows={result?.rows ?? []} />
      </div>
    </div>
  );
}

function SavedQueriesView({
  activeSavedQueryId,
  savedQueries,
  onDelete,
  onOpen
}: {
  activeSavedQueryId: string | null;
  savedQueries: SavedSqlQuery[];
  onDelete: (query: SavedSqlQuery) => void;
  onOpen: (query: SavedSqlQuery) => void;
}): ReactElement {
  return (
    <div className="saved-queries-view">
      <div className="panel-toolbar">
        <strong>Saved queries</strong>
        <span>{savedQueries.length.toLocaleString()}</span>
      </div>
      <div className="saved-query-list">
        {savedQueries.length === 0 ? <p className="saved-query-empty">No saved queries for this connection</p> : null}
        {savedQueries.map((query) => (
          <article key={query.id} className={`saved-query-item ${query.id === activeSavedQueryId ? "active" : ""}`}>
            <button type="button" onClick={() => onOpen(query)}>
              <span>{query.name}</span>
              <small>{savedQueryUpdatedLabel(query)}</small>
              <code>{query.sql}</code>
            </button>
            <button className="icon-button" type="button" title="Delete saved query" onClick={() => onDelete(query)}>
              <Trash2 size={14} />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

function savedQueryNameFromSql(sqlText: string): string {
  const firstLine = sqlText
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return "Untitled query";
  }

  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine;
}

function savedQueryUpdatedLabel(query: SavedSqlQuery): string {
  return `Updated ${new Date(query.updatedAt).toLocaleString()}`;
}

function StructureView({ structure }: { structure: TableStructure | null }): ReactElement {
  return (
    <div className="structure-view">
      <div className="split">
        <section>
          <h2>Columns</h2>
          <table className="meta-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Null</th>
                <th>Default</th>
              </tr>
            </thead>
            <tbody>
              {structure?.columns.map((column) => (
                <tr key={column.name}>
                  <td>
                    {column.isPrimaryKey ? <KeyRound size={13} /> : null}
                    {column.name}
                  </td>
                  <td>{column.dataType}</td>
                  <td>{column.nullable ? "YES" : "NO"}</td>
                  <td>{column.defaultValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h2>Indexes</h2>
          <table className="meta-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Definition</th>
              </tr>
            </thead>
            <tbody>
              {structure?.indexes.map((index) => (
                <tr key={index.name}>
                  <td>{index.name}</td>
                  <td>{index.isPrimary ? "Primary" : index.isUnique ? "Unique" : "Index"}</td>
                  <td>
                    <code>{index.definition}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function HistoryView({
  history,
  onClear,
  onUse
}: {
  history: QueryHistoryItem[];
  onClear: () => void;
  onUse: (sql: string) => void;
}): ReactElement {
  return (
    <div className="history-view">
      <div className="panel-toolbar">
        <strong>History</strong>
        <button className="button secondary" type="button" onClick={onClear}>
          <Trash2 size={15} />
          Clear
        </button>
      </div>
      <div className="history-list">
        {history.length === 0 ? <p className="history-empty">No history yet</p> : null}
        {history.map((item) => {
          const target = historyTargetLabel(item);

          return (
            <button key={item.id} type="button" className="history-item" onClick={() => onUse(item.sql)}>
              <FileClock size={15} />
              <span className="history-main">
                <span>{item.sql}</span>
                <small>
                  {historySourceLabel(item)}
                  {target ? ` / ${target}` : ""} / {item.command} / {item.durationMs}ms / {historyRowCountLabel(item)} /{" "}
                  {new Date(item.createdAt).toLocaleString()}
                </small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function historySourceLabel(item: QueryHistoryItem): string {
  switch (item.source) {
    case "table-data":
      return "Table data";
    case "row-edit":
      return "Row edit";
    case "query-editor":
    case undefined:
      return "Query editor";
  }
}

function historyTargetLabel(item: QueryHistoryItem): string {
  const target = item.target;
  if (!target?.schema || !target.table) {
    return "";
  }

  return `${target.schema}.${target.table}`;
}

function historyRowCountLabel(item: QueryHistoryItem): string {
  return item.rowCount === null ? "Rows unknown" : `${item.rowCount.toLocaleString()} rows`;
}

function StorageWorkspace({
  metadata,
  objects,
  prefix,
  preview,
  selectedObject,
  canGoBack,
  canPageBack,
  canPageForward,
  onBack,
  onCopy,
  onCreateFolder,
  onDelete,
  onDownload,
  onMove,
  onNextPage,
  onOpenFolder,
  onPreview,
  onPreviousPage,
  onRefresh,
  onSelect,
  onUploadFiles,
  onUploadFolder
}: {
  metadata: StorageObjectMetadata | null;
  objects: StorageObject[];
  prefix: string;
  preview: StoragePreviewResult | null;
  selectedObject: StorageObject | null;
  canGoBack: boolean;
  canPageBack: boolean;
  canPageForward: boolean;
  onBack: () => Promise<void>;
  onCopy: () => Promise<void>;
  onCreateFolder: () => Promise<void>;
  onDelete: () => Promise<void>;
  onDownload: () => Promise<void>;
  onMove: () => Promise<void>;
  onNextPage: () => Promise<void>;
  onOpenFolder: (prefix: string) => Promise<void>;
  onPreview: () => Promise<void>;
  onPreviousPage: () => Promise<void>;
  onRefresh: () => void;
  onSelect: (object: StorageObject) => void;
  onUploadFiles: () => Promise<void>;
  onUploadFolder: () => Promise<void>;
}): ReactElement {
  const selectedFile = selectedObject?.type === "file";

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
              disabled={!canGoBack}
            >
              <ChevronRight className="rotate-180" size={16} />
            </button>
            <strong>{prefix || "Bucket root"}</strong>
          </div>
          <div className="storage-actions">
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

        <div className="table-scroll storage-table-scroll">
          <table className="data-grid storage-grid" aria-label="Bucket objects">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Last modified</th>
                <th>ETag</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((object) => (
                <tr
                  className={selectedObject?.key === object.key ? "selected-row" : ""}
                  key={`${object.type}:${object.key}`}
                  onClick={() => onSelect(object)}
                  onDoubleClick={() => (object.type === "folder" ? void onOpenFolder(object.prefix) : void onPreview())}
                >
                  <td>
                    <span className="storage-name-cell">
                      {object.type === "folder" ? <Folder size={14} /> : <File size={14} />}
                      {object.name}
                    </span>
                  </td>
                  <td>{object.type}</td>
                  <td>{formatStorageSize(object.size)}</td>
                  <td>{object.lastModified ? new Date(object.lastModified).toLocaleString() : ""}</td>
                  <td>{object.etag}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="insert-row">
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
          <div className="insert-row-actions">
            <button
              className="button secondary"
              type="button"
              onClick={() => void onPreview()}
              disabled={!selectedFile}
            >
              <ImageIcon size={15} />
              Preview
            </button>
            <button
              className="button secondary"
              type="button"
              onClick={() => void onDownload()}
              disabled={!selectedFile}
            >
              <Download size={15} />
              Download
            </button>
            <button className="button secondary" type="button" onClick={() => void onCopy()} disabled={!selectedFile}>
              <Clipboard size={15} />
              Copy
            </button>
            <button className="button secondary" type="button" onClick={() => void onMove()} disabled={!selectedFile}>
              <Pencil size={15} />
              Rename
            </button>
            <button className="button danger" type="button" onClick={() => void onDelete()} disabled={!selectedObject}>
              <Trash2 size={15} />
              Delete
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
          <img className="storage-image-preview" alt={preview.key} src={preview.dataUrl} />
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
              <dd>{formatStorageSize(metadata.size)}</dd>
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

function ConnectionModal({
  groups,
  initial,
  onClose,
  onSave,
  onTest
}: {
  groups: ConnectionGroup[];
  initial?: ConnectionProfile;
  onClose: () => void;
  onSave: (input: ConnectionInput) => void;
  onTest: (input: ConnectionInput) => Promise<ConnectionTestResult>;
}): ReactElement {
  const [tab, setTab] = useState<"general" | "ssl" | "appearance">("general");
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<ConnectionInput>({
    ...EMPTY_CONNECTION,
    ...(initial ? defaultConnectionForEngine(initial.engine) : { engine: undefined }),
    ...initial,
    password: initial?.password ?? ""
  });

  useEffect(() => {
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
  }, []);

  const engine = form.engine;
  const sqlite = engine === "sqlite";
  const turso = engine === "turso";
  const d1 = engine === "cloudflare-d1";
  const s3 = engine === "s3-compatible";
  const providerToken = turso || d1 || s3;
  const supportsSsl = Boolean(engine) && !sqlite && !providerToken;
  const urlOverride = Boolean(form.connectionUrl);

  const update = <T extends keyof ConnectionInput>(key: T, value: ConnectionInput[T]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const updateEngine = (nextEngine: ConnectionEngine): void => {
    setTab("general");
    setForm((current) => ({
      ...defaultConnectionForEngine(nextEngine),
      id: current.id,
      groupId: current.groupId,
      name: current.name,
      color: current.color,
      detectJsonColumns: current.detectJsonColumns
    }));
  };
  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : EMPTY_CONNECTION.color;

  const connectionStringValue = engine
    ? form.connectionUrl || buildConnectionString({ ...form, engine, password: form.password ?? "" })
    : "";
  const connectionStringPlaceholder = engine
    ? engine === "sqlite"
      ? "sqlite:///path/to/database.sqlite"
      : engine === "turso"
        ? "libsql://database-org.turso.io?authToken=..."
        : engine === "cloudflare-d1"
          ? "d1://account-id/database-id?apiToken=..."
          : engine === "s3-compatible"
            ? "s3+https://access-key-id:secret-key@bucket?endpoint=https%3A%2F%2Fs3.example.com"
            : engine === "mysql"
              ? "mysql://user:password@localhost:3306/database"
              : "postgresql://user:password@localhost:5432/postgres"
    : "Choose a connection type to build a connection string";

  const mergeUrlIntoForm = (url: string): void => {
    try {
      const normalized = normalizeConnectionInput({ ...form, connectionUrl: url });
      setForm((current) => ({
        ...current,
        engine: normalized.engine,
        kind: normalized.kind,
        host: normalized.host,
        port: normalized.port,
        database: normalized.database,
        filePath: normalized.filePath,
        endpoint: normalized.endpoint,
        accountId: normalized.accountId,
        databaseId: normalized.databaseId,
        bucket: normalized.bucket,
        region: normalized.region,
        accessKeyId: normalized.accessKeyId,
        sessionToken: normalized.sessionToken,
        rootPrefix: normalized.rootPrefix,
        forcePathStyle: normalized.forcePathStyle,
        user: normalized.user,
        password: normalized.password ?? current.password,
        sslMode: normalized.sslMode,
        connectionUrl: undefined
      }));
    } catch {
      /* keep the typed connection string as-is */
    }
  };

  const copyConnectionString = async (): Promise<void> => {
    if (!connectionStringValue) {
      return;
    }
    await writeClipboardText(connectionStringValue);
    toast.success("Connection string copied");
  };

  const runTest = async (): Promise<void> => {
    if (!engine || testing) {
      return;
    }
    setTesting(true);
    try {
      const result = await onTest({ ...form, connectionUrl: undefined });
      if (result.profile) {
        setForm((current) => ({ ...current, id: result.profile?.id }));
      }
      if (result.ok) {
        toast.success("Connection successful", { description: result.message });
      } else {
        toast.error("Connection failed", { description: result.message });
      }
    } catch (error) {
      toast.error("Connection failed", { description: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  };

  const iconMode = form.iconMode ?? "default";
  const pickIconImage = async (): Promise<void> => {
    const dataUrl = await window.xdb.selectConnectionIconImage();
    if (dataUrl) {
      update("iconImage", dataUrl);
    }
  };

  const engineLabel = ENGINE_OPTIONS.find((option) => option.engine === engine)?.label;

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        className="connection-modal connection-modal-v2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.engine) {
            return;
          }
          onSave(form);
        }}
      >
        <header>
          <div className="connection-name-field">
            <input
              ref={nameInputRef}
              className="connection-name-input"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              placeholder="Enter the name of your connection"
              spellCheck={false}
            />
            {engineLabel ? <span className="connection-engine-badge">{engineLabel}</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </header>

        <div className="connection-modal-body">
          <aside className="connection-engine-sidebar">
            <p className="connection-section-caption">Database type</p>
            <nav className="engine-list" aria-label="Database type">
              {ENGINE_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.engine}
                  className={`engine-list-item ${engine === option.engine ? "active" : ""}`}
                  onClick={() => updateEngine(option.engine)}
                  title={option.label}
                >
                  <img className="engine-list-icon" src={ENGINE_ICON_URLS[option.engine]} alt="" />
                  <span className="engine-list-label">{option.label}</span>
                </button>
              ))}
            </nav>
          </aside>

          <div className="connection-modal-main">
            <div className="connection-modal-tabs" role="tablist" aria-label="Connection settings">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "general"}
                className={tab === "general" ? "active" : ""}
                onClick={() => setTab("general")}
              >
                General
              </button>
              {supportsSsl ? (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "ssl"}
                  className={tab === "ssl" ? "active" : ""}
                  onClick={() => setTab("ssl")}
                >
                  SSL
                </button>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={tab === "appearance"}
                className={tab === "appearance" ? "active" : ""}
                onClick={() => setTab("appearance")}
              >
                Appearance
              </button>
            </div>

            <div className="connection-modal-panel">
              {tab === "general" ? (
                engine ? (
                  <div className="connection-fields">
                    <label className="span-2">
                      <span className="connection-label">Connection string</span>
                      <span className="password-field">
                        <input
                          className="connection-string-input"
                          value={connectionStringValue}
                          onChange={(event) => update("connectionUrl", event.target.value)}
                          onBlur={() => {
                            if (form.connectionUrl) {
                              mergeUrlIntoForm(form.connectionUrl);
                            }
                          }}
                          placeholder={connectionStringPlaceholder}
                          spellCheck={false}
                          autoComplete="off"
                        />
                        <button
                          className="icon-button"
                          type="button"
                          title="Copy connection string"
                          onClick={() => void copyConnectionString()}
                        >
                          <Clipboard size={14} />
                        </button>
                      </span>
                    </label>

                    {sqlite ? (
                      <label className="span-2">
                        <span className="connection-label">Database file</span>
                        <span className="password-field">
                          <input
                            value={form.filePath ?? ""}
                            onChange={(event) => update("filePath", event.target.value)}
                            placeholder="/path/to/database.sqlite"
                            required={!urlOverride}
                          />
                          <button
                            className="button secondary"
                            type="button"
                            onClick={() => {
                              void (async () => {
                                const filePath = await window.xdb.selectSqliteDatabaseFile();
                                if (filePath) {
                                  update("filePath", filePath);
                                  update("database", filePath.split(/[/\\]/).pop() || filePath);
                                  if (!form.name.trim()) {
                                    update("name", filePath.split(/[/\\]/).pop() || filePath);
                                  }
                                }
                              })();
                            }}
                          >
                            <Folder size={15} />
                            Browse
                          </button>
                        </span>
                      </label>
                    ) : turso ? (
                      <>
                        <label className="span-2">
                          <span className="connection-label">Database URL</span>
                          <input
                            value={form.endpoint ?? ""}
                            onChange={(event) => update("endpoint", event.target.value)}
                            placeholder="libsql://database-org.turso.io"
                            required={!urlOverride}
                          />
                        </label>
                        <label className="span-2">
                          <span className="connection-label">Auth token</span>
                          <span className="password-field">
                            <input
                              type={showPassword ? "text" : "password"}
                              value={form.password ?? ""}
                              onChange={(event) => {
                                update("password", event.target.value);
                                if (event.target.value) {
                                  update("savePassword", true);
                                }
                              }}
                              required={!urlOverride}
                            />
                            <button
                              className="icon-button"
                              type="button"
                              title={showPassword ? "Hide auth token" : "Show auth token"}
                              onClick={() => setShowPassword((current) => !current)}
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </span>
                        </label>
                      </>
                    ) : d1 ? (
                      <>
                        <label>
                          <span className="connection-label">Account ID</span>
                          <input
                            value={form.accountId ?? ""}
                            onChange={(event) => update("accountId", event.target.value)}
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Database ID</span>
                          <input
                            value={form.databaseId ?? ""}
                            onChange={(event) => {
                              update("databaseId", event.target.value);
                              if (!form.database.trim()) {
                                update("database", event.target.value);
                              }
                            }}
                            required={!urlOverride}
                          />
                        </label>
                        <label className="span-2">
                          <span className="connection-label">API token</span>
                          <span className="password-field">
                            <input
                              type={showPassword ? "text" : "password"}
                              value={form.password ?? ""}
                              onChange={(event) => {
                                update("password", event.target.value);
                                if (event.target.value) {
                                  update("savePassword", true);
                                }
                              }}
                              required={!urlOverride}
                            />
                            <button
                              className="icon-button"
                              type="button"
                              title={showPassword ? "Hide API token" : "Show API token"}
                              onClick={() => setShowPassword((current) => !current)}
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </span>
                        </label>
                      </>
                    ) : s3 ? (
                      <>
                        <label className="span-2">
                          <span className="connection-label">Endpoint URL</span>
                          <input
                            value={form.endpoint ?? ""}
                            onChange={(event) => update("endpoint", event.target.value)}
                            placeholder="https://s3.example.com"
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Bucket</span>
                          <input
                            value={form.bucket ?? ""}
                            onChange={(event) => update("bucket", event.target.value)}
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Region</span>
                          <input
                            value={form.region ?? "us-east-1"}
                            onChange={(event) => update("region", event.target.value)}
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Access key ID</span>
                          <input
                            value={form.accessKeyId ?? ""}
                            onChange={(event) => update("accessKeyId", event.target.value)}
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Secret access key</span>
                          <span className="password-field">
                            <input
                              type={showPassword ? "text" : "password"}
                              value={form.password ?? ""}
                              onChange={(event) => {
                                update("password", event.target.value);
                                if (event.target.value) {
                                  update("savePassword", true);
                                }
                              }}
                              required={!urlOverride}
                            />
                            <button
                              className="icon-button"
                              type="button"
                              title={showPassword ? "Hide secret access key" : "Show secret access key"}
                              onClick={() => setShowPassword((current) => !current)}
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </span>
                        </label>
                        <label>
                          <span className="connection-label">Root prefix</span>
                          <input
                            value={form.rootPrefix ?? ""}
                            onChange={(event) => update("rootPrefix", event.target.value)}
                            placeholder="optional/folder/"
                          />
                        </label>
                        <label>
                          <span className="connection-label">Session token</span>
                          <input
                            value={form.sessionToken ?? ""}
                            onChange={(event) => update("sessionToken", event.target.value)}
                          />
                        </label>
                        <label className="checkbox-label span-2">
                          <input
                            type="checkbox"
                            checked={form.forcePathStyle ?? true}
                            onChange={(event) => update("forcePathStyle", event.target.checked)}
                          />
                          Force path style
                        </label>
                      </>
                    ) : (
                      <>
                        <label>
                          <span className="connection-label">Host</span>
                          <input
                            value={form.host}
                            onChange={(event) => update("host", event.target.value)}
                            placeholder="localhost"
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Port</span>
                          <input
                            type="number"
                            value={form.port}
                            onChange={(event) => update("port", Number(event.target.value))}
                            required={!urlOverride}
                          />
                        </label>
                        <label className="span-2">
                          <span className="connection-label">Database</span>
                          <input
                            value={form.database}
                            onChange={(event) => update("database", event.target.value)}
                            placeholder={engine === "mysql" ? "app" : "postgres"}
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">User</span>
                          <input
                            value={form.user}
                            onChange={(event) => update("user", event.target.value)}
                            placeholder="Enter the user name"
                            required={!urlOverride}
                          />
                        </label>
                        <label>
                          <span className="connection-label">Password</span>
                          <span className="password-field">
                            <input
                              type={showPassword ? "text" : "password"}
                              value={form.password ?? ""}
                              onChange={(event) => {
                                update("password", event.target.value);
                                if (event.target.value) {
                                  update("savePassword", true);
                                }
                              }}
                              placeholder="Enter the password"
                            />
                            <button
                              className="icon-button"
                              type="button"
                              title={showPassword ? "Hide password" : "Show password"}
                              onClick={() => setShowPassword((current) => !current)}
                            >
                              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                            </button>
                          </span>
                        </label>
                      </>
                    )}

                    <label className="checkbox-label span-2">
                      <input
                        type="checkbox"
                        checked={form.savePassword}
                        onChange={(event) => update("savePassword", event.target.checked)}
                      />
                      {s3 ? "Save secret access key" : providerToken ? "Save token" : "Save password in Keychain"}
                    </label>

                    {!s3 ? (
                      <div className="connection-option span-2">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={form.detectJsonColumns ?? false}
                            onChange={(event) => update("detectJsonColumns", event.target.checked)}
                          />
                          Detect JSON in text columns
                        </label>
                        <p className="connection-option-help">
                          Show the JSON viewer when an untyped text cell contains a JSON object or array. Adds a small
                          parsing cost per cell.
                        </p>
                      </div>
                    ) : null}

                    <label className="span-2">
                      <span className="connection-label">Group</span>
                      <select
                        value={form.groupId ?? ""}
                        onChange={(event) => update("groupId", event.target.value || undefined)}
                      >
                        <option value="">Ungrouped</option>
                        {groups.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="connection-test-row">
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => void runTest()}
                        disabled={testing}
                      >
                        {testing ? <Loader2 size={14} className="spin" /> : <Server size={14} />}
                        Test Connection
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="connection-modal-empty">
                    <Server size={18} />
                    <strong>Select a connection type</strong>
                    <p>Choose a database or storage type from the left to show the setup fields.</p>
                  </div>
                )
              ) : null}

              {tab === "ssl" && supportsSsl ? (
                <div className="connection-fields">
                  <label className="span-2">
                    <span className="connection-label">SSL mode</span>
                    <select value={form.sslMode} onChange={(event) => update("sslMode", event.target.value as SslMode)}>
                      <option value="disable">Disable</option>
                      <option value="prefer">Prefer</option>
                      <option value="require">Require</option>
                    </select>
                  </label>
                  <p className="connection-option-help span-2">
                    Prefer encrypts the connection when the server supports it. Require always enforces encryption.
                  </p>
                </div>
              ) : null}

              {tab === "appearance" ? (
                <div className="connection-appearance">
                  <section className="appearance-section">
                    <p className="connection-section-caption">Preview</p>
                    <div className="appearance-preview">
                      <span className="connection-picker-status" style={{ background: form.color }} />
                      <ConnectionEngineIcon source={form} />
                      <strong className="appearance-preview-name">{form.name || "Unnamed connection"}</strong>
                    </div>
                  </section>

                  <section className="appearance-section">
                    <p className="connection-section-caption">Accent color</p>
                    <div className="color-control">
                      <div className="color-swatches">
                        {CONNECTION_COLORS.map((color) => (
                          <button
                            className={`color-swatch ${form.color.toLowerCase() === color.value ? "active" : ""}`}
                            key={color.value}
                            type="button"
                            title={color.name}
                            aria-label={color.name}
                            aria-pressed={form.color.toLowerCase() === color.value}
                            style={{ background: color.value }}
                            onClick={() => update("color", color.value)}
                          />
                        ))}
                      </div>
                      <div className="custom-color">
                        <input
                          className="custom-color-picker"
                          type="color"
                          title="Custom color"
                          value={colorPickerValue}
                          onChange={(event) => update("color", event.target.value)}
                        />
                        <input
                          className="custom-color-value"
                          value={form.color}
                          maxLength={7}
                          spellCheck={false}
                          onChange={(event) => {
                            const nextColor = event.target.value;
                            update("color", nextColor.startsWith("#") ? nextColor : `#${nextColor}`);
                          }}
                          onBlur={() => {
                            if (!/^#[0-9a-fA-F]{6}$/.test(form.color)) {
                              update("color", EMPTY_CONNECTION.color);
                            }
                          }}
                        />
                      </div>
                    </div>
                  </section>

                  <section className="appearance-section">
                    <p className="connection-section-caption">Icon</p>
                    <div className="icon-mode-row" role="radiogroup" aria-label="Connection icon">
                      {ICON_MODE_OPTIONS.map((option) => (
                        <label key={option.mode} className={`icon-mode ${iconMode === option.mode ? "active" : ""}`}>
                          <input
                            type="radio"
                            className="icon-mode-input"
                            name="connection-icon-mode"
                            value={option.mode}
                            checked={iconMode === option.mode}
                            onChange={() => update("iconMode", option.mode)}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>

                    {iconMode === "default" ? (
                      <p className="connection-option-help">Using the default driver icon.</p>
                    ) : null}

                    {iconMode === "icon" ? (
                      <div className="icon-picker-grid">
                        {Object.entries(CONNECTION_ICONS).map(([name, Icon]) => (
                          <button
                            type="button"
                            key={name}
                            className={`icon-picker-item ${form.iconName === name ? "active" : ""}`}
                            title={name}
                            aria-pressed={form.iconName === name}
                            onClick={() => update("iconName", name)}
                          >
                            <Icon size={16} />
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {iconMode === "emoji" ? (
                      <div className="appearance-emoji-field">
                        <div className="emoji-picker">
                          {EMOJI_CHOICES.map((emoji) => (
                            <button
                              type="button"
                              key={emoji}
                              className={`emoji-picker-item ${form.iconEmoji === emoji ? "active" : ""}`}
                              title={emoji}
                              aria-pressed={form.iconEmoji === emoji}
                              onClick={() => update("iconEmoji", emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                        <p className="connection-option-help">Pick an emoji to use as the connection icon.</p>
                      </div>
                    ) : null}

                    {iconMode === "image" ? (
                      <div className="appearance-image-field">
                        <button className="button secondary" type="button" onClick={() => void pickIconImage()}>
                          <Upload size={14} />
                          {form.iconImage ? "Replace image" : "Choose image"}
                        </button>
                        {form.iconImage ? (
                          <button
                            type="button"
                            className="button secondary"
                            onClick={() => update("iconImage", undefined)}
                          >
                            <Trash2 size={14} />
                            Remove
                          </button>
                        ) : null}
                        <p className="connection-option-help">PNG, JPG, GIF, WEBP, SVG, or BMP. Max 512 KB.</p>
                      </div>
                    ) : null}
                  </section>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={!engine}>
            <Save size={15} />
            Save
          </button>
        </footer>
      </form>
    </ModalBackdrop>
  );
}

function ConnectionGroupModal({
  initial,
  onClose,
  onSave
}: {
  initial?: ConnectionGroup;
  onClose: () => void;
  onSave: (input: ConnectionGroupInput) => void;
}): ReactElement {
  const [form, setForm] = useState<ConnectionGroupInput>({
    id: initial?.id,
    name: initial?.name ?? "",
    color: initial?.color ?? DEFAULT_CONNECTION_GROUP_COLOR
  });

  const colorPickerValue = /^#[0-9a-fA-F]{6}$/.test(form.color) ? form.color : DEFAULT_CONNECTION_GROUP_COLOR;

  return (
    <ModalBackdrop onClose={onClose}>
      <form
        className="connection-modal group-modal"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...form, name: form.name.trim() });
        }}
      >
        <header>
          <h1>{initial ? "Edit Group" : "New Group"}</h1>
          <button className="icon-button" type="button" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="form-grid">
          <label className="span-2">
            Name
            <input
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              required
            />
          </label>
          <label className="span-2">
            Color
            <div className="color-control">
              <div className="color-swatches">
                {CONNECTION_COLORS.map((color) => (
                  <button
                    className={`color-swatch ${form.color.toLowerCase() === color.value ? "active" : ""}`}
                    key={color.value}
                    type="button"
                    title={color.name}
                    aria-label={color.name}
                    aria-pressed={form.color.toLowerCase() === color.value}
                    style={{ background: color.value }}
                    onClick={() => setForm((current) => ({ ...current, color: color.value }))}
                  />
                ))}
              </div>
              <div className="custom-color">
                <input
                  className="custom-color-picker"
                  type="color"
                  title="Custom color"
                  value={colorPickerValue}
                  onChange={(event) => setForm((current) => ({ ...current, color: event.target.value }))}
                />
                <input
                  className="custom-color-value"
                  value={form.color}
                  maxLength={7}
                  spellCheck={false}
                  onChange={(event) => {
                    const nextColor = event.target.value;
                    setForm((current) => ({
                      ...current,
                      color: nextColor.startsWith("#") ? nextColor : `#${nextColor}`
                    }));
                  }}
                  onBlur={() => {
                    if (!/^#[0-9a-fA-F]{6}$/.test(form.color)) {
                      setForm((current) => ({ ...current, color: DEFAULT_CONNECTION_GROUP_COLOR }));
                    }
                  }}
                />
              </div>
            </div>
          </label>
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            <Save size={15} />
            {initial ? "Save" : "Create"}
          </button>
        </footer>
      </form>
    </ModalBackdrop>
  );
}

function ResultTable({ rows }: { rows: Record<string, unknown>[] }): ReactElement {
  const columns = rows[0] ? Object.keys(rows[0]) : [];

  return (
    <div className="table-scroll">
      <table className="data-grid compact">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={columns.map((column) => formatCell(row[column])).join("\u0000")}>
              {columns.map((column) => (
                <td key={column}>{formatCell(row[column])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CopyRowSubmenu({
  disabled,
  selectedRowCount,
  onCopy
}: {
  disabled?: boolean;
  selectedRowCount: number;
  onCopy: (format: ClipboardRowFormat) => void;
}): ReactElement {
  return (
    <div className="context-submenu">
      <button
        className="context-submenu-trigger"
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        disabled={disabled}
        onClick={(event) => event.stopPropagation()}
      >
        <Clipboard size={14} />
        {selectedRowCount > 1 ? `Copy ${selectedRowCount} rows` : "Copy row"}
        <ChevronRight className="context-submenu-arrow" size={14} />
      </button>
      {disabled ? null : (
        <div className="context-submenu-panel" role="menu">
          {COPY_ROW_FORMATS.map((item) => (
            <button key={item.format} type="button" role="menuitem" onClick={() => onCopy(item.format)}>
              <Clipboard size={14} />
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteRowConfirmationDialog({
  primaryKeys,
  rows,
  tableName,
  onCancel,
  onConfirm
}: {
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  tableName: string;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  const rowCount = rows.length;
  const rowIdentity = rowCount === 1 ? primaryKeys.map((key) => `${key}: ${formatCell(rows[0][key])}`).join(" / ") : "";

  return (
    <ModalBackdrop onClose={onCancel}>
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-row-title">
        <header>
          <div>
            <h1 id="delete-row-title">{rowCount > 1 ? `Delete ${rowCount.toLocaleString()} rows?` : "Delete row?"}</h1>
            <span>{tableName}</span>
          </div>
          <button className="icon-button" type="button" title="Cancel delete" onClick={onCancel}>
            <X size={15} />
          </button>
        </header>

        <div className="confirmation-dialog-body">
          <p>
            {rowCount > 1
              ? "These rows will be permanently deleted from the database."
              : "This row will be permanently deleted from the database."}
          </p>
          {rowIdentity ? <code>{rowIdentity}</code> : null}
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button danger" type="button" onClick={onConfirm}>
            <Trash2 size={15} />
            {rowCount > 1 ? "Delete rows" : "Delete row"}
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}

function CloseObjectTabConfirmationDialog({
  tab,
  onCancel,
  onConfirm
}: {
  tab: ObjectTab | null;
  onCancel: () => void;
  onConfirm: () => void;
}): ReactElement {
  return (
    <ModalBackdrop onClose={onCancel}>
      <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="close-tab-title">
        <header>
          <div>
            <h1 id="close-tab-title">Discard changes?</h1>
            <span>{tab ? objectDisplayName(tab.object) : "Open tab"}</span>
          </div>
          <button className="icon-button" type="button" title="Cancel close" onClick={onCancel}>
            <X size={15} />
          </button>
        </header>

        <div className="confirmation-dialog-body">
          <p>This tab has unsaved row edits. Closing it will discard those changes.</p>
        </div>

        <footer>
          <button className="button secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="button danger" type="button" onClick={onConfirm}>
            <Trash2 size={15} />
            Discard and close
          </button>
        </footer>
      </section>
    </ModalBackdrop>
  );
}

function WorkspaceModeFooter({ children }: { children: ReactNode }): ReactElement {
  return <div className="workspace-mode-footer">{children}</div>;
}

function WorkspaceFooterControls({
  activeMode,
  hasActiveObject,
  loading,
  onModeChange
}: {
  activeMode: MainTab;
  hasActiveObject: boolean;
  loading: boolean;
  onModeChange: (mode: MainTab) => void;
}): ReactElement {
  return (
    <div className="workspace-footer-controls">
      {loading ? <Loader2 className="spin loading-indicator" size={15} /> : null}
      <div className="mode-toggle-group" role="tablist" aria-label="Workspace view">
        <ModeToggleButton
          active={activeMode === "data"}
          disabled={!hasActiveObject}
          label="Data"
          onClick={() => onModeChange("data")}
        />
        <ModeToggleButton active={activeMode === "query"} label="Query" onClick={() => onModeChange("query")} />
        <ModeToggleButton
          active={activeMode === "structure"}
          disabled={!hasActiveObject}
          label="Structure"
          onClick={() => onModeChange("structure")}
        />
        <ModeToggleButton active={activeMode === "history"} label="History" onClick={() => onModeChange("history")} />
      </div>
    </div>
  );
}

function ModeToggleButton({
  active,
  disabled = false,
  label,
  onClick
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      aria-selected={active}
      className={`mode-toggle-button ${active ? "active" : ""}`}
      disabled={disabled}
      role="tab"
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

async function writeClipboardText(content: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = content;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.inset = "0 auto auto -9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim();
}

function backupProgressDescription(progress: DatabaseBackupProgress): string {
  switch (progress.phase) {
    case "selecting-folder":
      return "Choose where to save the backup.";
    case "preparing":
      return "Connecting to database...";
    case "schema":
      return "Exporting schema...";
    case "data": {
      const counts =
        progress.tablesDone !== undefined && progress.tablesTotal
          ? ` (${progress.tablesDone + 1}/${progress.tablesTotal})`
          : "";
      return progress.table ? `Exporting ${progress.table}${counts}...` : "Exporting data...";
    }
    case "done":
      return "Backup saved.";
    case "failed":
      return "Backup failed.";
    case "cancelled":
      return "Backup cancelled.";
  }
}

function restoreProgressDescription(progress: DatabaseRestoreProgress): string {
  switch (progress.phase) {
    case "selecting-file":
      return "Choose a backup file to restore.";
    case "preparing":
      return "Connecting to database...";
    case "executing":
      return progress.statementsDone ? `Executed ${progress.statementsDone} statements...` : "Restoring schema...";
    case "copying-data":
      return progress.table ? `Loading ${progress.table}...` : "Loading data...";
    case "done":
      return "Restore complete.";
    case "failed":
      return "Restore failed.";
    case "cancelled":
      return "Restore cancelled.";
  }
}

function defaultSqlForEngine(engine: DatabaseEngine): string {
  switch (engine) {
    case "mysql":
      return "select database(), current_user(), version();";
    case "sqlite":
    case "turso":
      return "select sqlite_version();";
    case "cloudflare-d1":
      return "select 1;";
    case "postgresql":
      return DEFAULT_SQL;
  }
}

function connectionStatusLabel(status: ConnectionRuntimeStatus | null): string {
  if (!status) {
    return "";
  }

  if (status.engine === "s3-compatible") {
    return `${status.bucket} / ${status.region}`;
  }

  if (status.engine === "sqlite") {
    return `${status.database} / SQLite ${status.serverVersion}`;
  }

  if (status.engine === "turso") {
    return `${status.database} / Turso ${status.serverVersion}`;
  }

  if (status.engine === "cloudflare-d1") {
    return `${status.database} / Cloudflare D1`;
  }

  if (status.engine === "mysql") {
    return `${status.database} / ${status.currentUser} / MySQL ${status.serverVersion}`;
  }

  return `${status.database} / ${status.currentUser} / PostgreSQL ${status.serverVersion}`;
}

function profileDisplayTarget(profile: ConnectionProfile): string {
  if (profile.engine === "s3-compatible") {
    return `${profile.bucket ?? "bucket"} @ ${profile.endpoint ?? ""}`;
  }

  if (profile.engine === "sqlite") {
    return profile.filePath || profile.database;
  }

  if (profile.engine === "turso") {
    return profile.endpoint || profile.database;
  }

  if (profile.engine === "cloudflare-d1") {
    return profile.databaseId || profile.database;
  }

  return `${profile.database} on ${profile.host}`;
}

function profileConnectionSubtitle(profile: ConnectionProfile): string {
  if (profile.engine === "s3-compatible") {
    return profile.rootPrefix
      ? `${profile.region ?? "us-east-1"} / ${profile.rootPrefix}`
      : (profile.region ?? "us-east-1");
  }

  if (profile.engine === "sqlite") {
    return profile.filePath || profile.database;
  }

  if (profile.engine === "turso") {
    return profile.endpoint || profile.database;
  }

  if (profile.engine === "cloudflare-d1") {
    return `${profile.accountId ?? ""}/${profile.databaseId ?? profile.database}`;
  }

  return `${profile.user}@${profile.host}:${profile.port}`;
}

function duplicateConnectionInput(source: ConnectionProfile, profiles: ConnectionProfile[]): ConnectionInput {
  const { id: _id, hasPassword: _hasPassword, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = source;

  return {
    ...input,
    name: nextDuplicateConnectionName(source.name || source.database || source.bucket || "Connection", profiles),
    password: source.password ?? "",
    connectionUrl: undefined
  };
}

function nextDuplicateConnectionName(name: string, profiles: ConnectionProfile[]): string {
  const baseName = name.trim() || "Connection";
  const existingNames = new Set(profiles.map((profile) => profile.name));
  const firstCandidate = `${baseName} copy`;
  if (!existingNames.has(firstCandidate)) {
    return firstCandidate;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName} copy ${index}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }

  return `${baseName} copy ${Date.now()}`;
}

function parentStoragePrefix(prefix: string): string {
  const parts = prefix.replace(/\/+$/, "").split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `${parts.join("/")}/` : "";
}

function formatStorageSize(value: number | null): string {
  if (value === null) {
    return "";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`;
}

function rowKeyFor(primaryKeys: string[], row: Record<string, unknown>, index: number): string {
  if (primaryKeys.length === 0) {
    return `row:${index}`;
  }

  return JSON.stringify(primaryKeyForRow(primaryKeys, row));
}

function cellInputKey(rowKey: string, columnName: string): string {
  return `${rowKey}\u0000${columnName}`;
}

function objectTabId(profileId: string, object: DatabaseObject): ObjectTabId {
  return `${profileId}:${object.schema}.${object.name}`;
}

function objectDisplayName(object: DatabaseObject): string {
  return `${object.schema}.${object.name}`;
}

function isTableObject(object: DatabaseObject): boolean {
  return object.type === "base_table" || object.type === "foreign_table";
}

function defaultObjectMode(object: DatabaseObject): MainTab {
  return isTableObject(object) ? "data" : "structure";
}

function createObjectTab(profileId: string, object: DatabaseObject, pinned: boolean): ObjectTab {
  const id = objectTabId(profileId, object);

  return {
    id,
    object,
    pinned,
    mode: defaultObjectMode(object),
    page: 1,
    tableData: null,
    structure: null,
    draftRows: {},
    stagedRow: null,
    draftFilters: EMPTY_TABLE_FILTERS,
    appliedFilters: EMPTY_TABLE_FILTERS,
    tableSort: null,
    filtersVisible: false,
    filterTableKey: id
  };
}

function createFilteredObjectTab(profileId: string, object: DatabaseObject, column: string, value: unknown): ObjectTab {
  const baseTab = createObjectTab(profileId, object, true);
  const id = `${objectTabId(profileId, object)}:filter:${crypto.randomUUID()}`;
  const filterRule: TableFilterRule =
    value === null || value === undefined
      ? {
          id: crypto.randomUUID(),
          enabled: true,
          column,
          operator: "isNull",
          value: ""
        }
      : {
          id: crypto.randomUUID(),
          enabled: true,
          column,
          operator: "equals",
          value: formatCell(value)
        };
  const filters = { rules: [filterRule] };

  return {
    ...baseTab,
    id,
    draftFilters: filters,
    appliedFilters: filters,
    filtersVisible: true,
    filterTableKey: id
  };
}

function nextTableSort(current: TableSortInput | null, column: string): TableSortInput | null {
  if (current?.column !== column) {
    return { column, direction: SORT_DIRECTIONS[0] };
  }

  if (current.direction === "desc") {
    return { column, direction: SORT_DIRECTIONS[1] };
  }

  return null;
}

function isBooleanColumn(column: TableColumn): boolean {
  const dataType = (column.dataType ?? "").toLowerCase();
  return dataType === "boolean" || dataType === "bool" || dataType === "tinyint(1)";
}

function dateControlType(column: TableColumn): "date" | "datetime-local" | "time" | null {
  const dataType = (column.dataType ?? "").toLowerCase();

  if (dataType.includes("timestamp") || dataType.includes("datetime")) {
    return "datetime-local";
  }

  if (dataType === "date") {
    return "date";
  }

  if (dataType.includes("time")) {
    return "time";
  }

  return null;
}

function tableColumnEnumValues(column: TableColumn): string[] {
  return Array.isArray(column.enumValues) ? column.enumValues : [];
}

function booleanEditorValue(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "false") {
    return normalized;
  }
  return "null";
}

function dateEditorValue(value: string, type: "date" | "datetime-local" | "time"): string {
  if (value === "NULL") {
    return "";
  }

  if (type === "date") {
    return value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  }

  if (type === "time") {
    return value.match(/\d{2}:\d{2}(?::\d{2})?/)?.[0] ?? "";
  }

  const normalized = value.replace(" ", "T");
  return normalized.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?/)?.[0] ?? "";
}

function nowCellValue(column: TableColumn): string {
  const now = new Date();
  const type = dateControlType(column);
  const pad = (value: number): string => String(value).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  if (type === "date") {
    return date;
  }

  if (type === "time") {
    return time;
  }

  return `${date}T${time}`;
}

function isObjectTabDirty(tab: ObjectTab): boolean {
  return Object.keys(tab.draftRows).length > 0 || hasStagedRowValues(tab.stagedRow);
}

function hasStagedRowValues(stagedRow: StagedRow | null): boolean {
  return Object.values(stagedRow ?? {}).some((value) => value.trim() !== "");
}

function reorderObjectTabs(
  tabs: ObjectTab[],
  sourceTabId: ObjectTabId,
  targetTabId: ObjectTabId,
  side: "before" | "after"
): ObjectTab[] {
  if (sourceTabId === targetTabId) {
    return tabs;
  }

  const sourceTab = tabs.find((tab) => tab.id === sourceTabId);
  if (!sourceTab) {
    return tabs;
  }

  const nextTabs = tabs.filter((tab) => tab.id !== sourceTabId);
  const targetIndex = nextTabs.findIndex((tab) => tab.id === targetTabId);
  if (targetIndex === -1) {
    return tabs;
  }

  nextTabs.splice(side === "before" ? targetIndex : targetIndex + 1, 0, sourceTab);
  return nextTabs;
}

function createDefaultFilterRule(): TableFilterRule {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    column: null,
    operator: "contains",
    value: ""
  };
}

function normalizeTableFilters(filters: TableFilterInput): TableFilterInput {
  return {
    rules: filters.rules
      .map((rule) => ({
        ...rule,
        column: rule.column?.trim() || null,
        value: rule.value.trim()
      }))
      .filter((rule) => rule.enabled && isCompleteFilterRule(rule))
  };
}

function countAppliedFilterRules(filters: TableFilterInput): number {
  return normalizeTableFilters(filters).rules.length;
}

function isCompleteFilterRule(rule: TableFilterRule): boolean {
  if (!TABLE_FILTER_OPERATORS.some((option) => option.operator === rule.operator)) {
    return false;
  }

  if (rule.column === null && !ANY_COLUMN_FILTER_OPERATORS.has(rule.operator)) {
    return false;
  }

  if (!filterOperatorRequiresValue(rule.operator)) {
    return true;
  }

  if (rule.operator === "in" || rule.operator === "notIn") {
    return rule.value
      .split(",")
      .map((item) => item.trim())
      .some(Boolean);
  }

  return rule.value.trim() !== "";
}

function filterOperatorRequiresValue(operator: TableFilterOperator): boolean {
  return !VALUELESS_FILTER_OPERATORS.has(operator);
}

function buildConnectionGroupSections(
  profiles: ConnectionProfile[],
  groups: ConnectionGroup[]
): ConnectionGroupSection[] {
  const groupIds = new Set(groups.map((group) => group.id));
  const sections = groups.map((group) => ({
    group,
    connections: profiles.filter((profile) => profile.groupId === group.id)
  }));
  const ungrouped = profiles.filter((profile) => !profile.groupId || !groupIds.has(profile.groupId));

  return ungrouped.length ? [...sections, { group: null, connections: ungrouped }] : sections;
}

function isPrimaryModifierShortcut(event: KeyboardEvent): boolean {
  if (isMacPlatform()) {
    return event.metaKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.metaKey;
}

function isSidebarToggleShortcut(event: KeyboardEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.altKey &&
    !event.shiftKey &&
    isPrimaryModifierShortcut(event) &&
    event.key.toLowerCase() === SIDEBAR_TOGGLE_KEY
  );
}

function isMacPlatform(): boolean {
  return /Mac|iPhone|iPad|iPod/.test(window.navigator.platform);
}

function resolveThemePreference(theme: ThemePreference): ResolvedTheme {
  if (theme === "light" || theme === "dark") {
    return theme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readStoredBoolean(storageKey: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(storageKey: string, value: boolean): void {
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Layout persistence should never block the app.
  }
}

function readStoredNumber(storageKey: string): number | null {
  try {
    const value = window.localStorage.getItem(storageKey);
    if (value === null) {
      return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? clampObjectsSidebarWidth(parsed) : null;
  } catch {
    return null;
  }
}

function writeStoredNumber(storageKey: string, value: number): void {
  try {
    window.localStorage.setItem(storageKey, String(value));
  } catch {
    // Layout persistence should never block the app.
  }
}

function removeStoredValue(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Layout persistence should never block the app.
  }
}

function tableColumnLayoutStorageKey(profileId: string, schema: string, table: string): string {
  return `xdb:data-grid-layout:${profileId}:${schema}.${table}`;
}

function readColumnLayout(storageKey: string, columnNames: string[]): ColumnLayout {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<ColumnLayout>) : undefined;
    return reconcileColumnLayout(
      {
        order: Array.isArray(parsed?.order) ? parsed.order.filter((item) => typeof item === "string") : [],
        widths: isRecord(parsed?.widths) ? parsed.widths : {}
      },
      columnNames
    );
  } catch {
    return reconcileColumnLayout({ order: [], widths: {} }, columnNames);
  }
}

function reconcileColumnLayout(layout: ColumnLayout, columnNames: string[]): ColumnLayout {
  const columns = new Set(columnNames);
  const order = [...layout.order.filter((columnName) => columns.has(columnName))];

  for (const columnName of columnNames) {
    if (!order.includes(columnName)) {
      order.push(columnName);
    }
  }

  const widths = Object.fromEntries(
    columnNames.map((columnName) => [columnName, clampColumnWidth(Number(layout.widths[columnName]))])
  );

  return { order, widths };
}

function reorderColumn(
  order: string[],
  sourceColumn: string,
  targetColumn: string,
  side: "before" | "after"
): string[] {
  const nextOrder = order.filter((columnName) => columnName !== sourceColumn);
  const targetIndex = nextOrder.indexOf(targetColumn);

  if (targetIndex === -1) {
    return order;
  }

  nextOrder.splice(side === "before" ? targetIndex : targetIndex + 1, 0, sourceColumn);
  return nextOrder;
}

function autosizeColumnWidth(values: string[]): number {
  const longestVisibleText = values.reduce((longest, value) => {
    const longestLine = value.split("\n").reduce((lineLongest, line) => Math.max(lineLongest, line.length), 0);
    return Math.max(longest, longestLine);
  }, 0);

  return clampColumnWidth(longestVisibleText * 8 + 36);
}

function clampColumnWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Number.isFinite(width) ? width : DEFAULT_COLUMN_WIDTH));
}

function clampObjectsSidebarWidth(width: number): number {
  return Math.min(
    MAX_OBJECTS_SIDEBAR_WIDTH,
    Math.max(MIN_OBJECTS_SIDEBAR_WIDTH, Number.isFinite(width) ? Math.round(width) : DEFAULT_OBJECTS_SIDEBAR_WIDTH)
  );
}

function isRecord(value: unknown): value is Record<string, number> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function setsEqual(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isCellValueUnchanged(originalValue: unknown, nextValue: unknown, inputValue: string): boolean {
  return formatCell(originalValue) === inputValue || valuesAreEqual(originalValue, nextValue);
}

function valuesAreEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => valuesAreEqual(value, right[index]));
  }

  const leftObject = left as Record<string, unknown>;
  const rightObject = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftObject);
  const rightKeys = Object.keys(rightObject);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.hasOwn(rightObject, key) && valuesAreEqual(leftObject[key], rightObject[key]))
  );
}

function primaryKeyForRow(primaryKeys: string[], row: Record<string, unknown>): Record<string, unknown> {
  if (primaryKeys.length === 0) {
    throw new Error("This table does not expose a primary key.");
  }

  return Object.fromEntries(primaryKeys.map((key) => [key, row[key]]));
}
