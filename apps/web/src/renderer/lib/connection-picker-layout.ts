import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionPickerLayout } from "../../shared/types";
import {
  applyConnectionPickerLayout,
  createDefaultLayout,
  reconcileConnectionPickerLayout,
  reorderIds,
  type ConnectionGroupSectionLike,
  type ReorderSide,
  CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY,
  CONNECTION_PICKER_LAYOUT_STORAGE_KEY
} from "../../shared/connection-picker-layout";

export {
  connectionGroupSectionKey,
  createDefaultLayout,
  reconcileConnectionPickerLayout,
  applyConnectionPickerLayout,
  reorderIds,
  UNGROUPED_SECTION_KEY
} from "../../shared/connection-picker-layout";

export type { ConnectionGroupSectionLike, ConnectionPickerLayout, ReorderSide };

export const CONNECTION_PICKER_LAYOUT_STORAGE_KEY_RENDERER = CONNECTION_PICKER_LAYOUT_STORAGE_KEY;
export const CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY_RENDERER = CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY;

type GroupDropTarget = {
  groupKey: string;
  side: ReorderSide;
};

type ConnectionDropTarget = {
  groupKey: string;
  profileId: string;
  side: ReorderSide;
};

function readLegacyCollapsedGroupIds(): string[] {
  try {
    const raw = window.localStorage.getItem(CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function readLegacyLayout(): ConnectionPickerLayout | null {
  try {
    const raw = window.localStorage.getItem(CONNECTION_PICKER_LAYOUT_STORAGE_KEY);
    if (!raw) {
      const collapsedGroupIds = readLegacyCollapsedGroupIds();
      return collapsedGroupIds.length ? { collapsedGroupIds, groupOrder: [], connectionOrder: {} } : null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const record = parsed as Partial<ConnectionPickerLayout>;
    return {
      collapsedGroupIds: Array.isArray(record.collapsedGroupIds)
        ? record.collapsedGroupIds.filter((item): item is string => typeof item === "string")
        : readLegacyCollapsedGroupIds(),
      groupOrder: Array.isArray(record.groupOrder)
        ? record.groupOrder.filter((item): item is string => typeof item === "string")
        : [],
      connectionOrder: Object.fromEntries(
        Object.entries(record.connectionOrder ?? {}).filter((entry): entry is [string, string[]] =>
          Array.isArray(entry[1])
        )
      )
    };
  } catch {
    return null;
  }
}

function clearLegacyLayout(): void {
  try {
    window.localStorage.removeItem(CONNECTION_PICKER_LAYOUT_STORAGE_KEY);
    window.localStorage.removeItem(CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY);
  } catch {
    // Legacy cleanup should never block the app.
  }
}

export function useConnectionPickerLayout<T extends ConnectionGroupSectionLike>(rawSections: T[]) {
  const [layout, setLayout] = useState<ConnectionPickerLayout | null>(null);
  const [loaded, setLoaded] = useState(false);
  const rawSectionsRef = useRef(rawSections);
  rawSectionsRef.current = rawSections;

  useEffect(() => {
    let cancelled = false;

    void (async (): Promise<void> => {
      try {
        let stored = await window.pixql.getConnectionPickerLayout();
        let migratedLegacy = false;

        if (!stored) {
          const legacy = readLegacyLayout();
          if (legacy) {
            stored = legacy;
            migratedLegacy = true;
          }
        }

        if (cancelled) {
          return;
        }

        setLayout(stored);
        setLoaded(true);

        if (migratedLegacy && stored) {
          try {
            await window.pixql.saveConnectionPickerLayout(stored);
          } catch {
            // Best-effort migration write.
          } finally {
            clearLegacyLayout();
          }
        }
      } catch {
        if (!cancelled) {
          setLayout(createDefaultLayout(rawSectionsRef.current));
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const displayLayout = useMemo(() => {
    const base = layout ?? createDefaultLayout(rawSections);
    return reconcileConnectionPickerLayout(base, rawSections);
  }, [layout, rawSections]);
  const displayLayoutRef = useRef(displayLayout);
  displayLayoutRef.current = displayLayout;

  const sections = useMemo(() => applyConnectionPickerLayout(rawSections, displayLayout), [rawSections, displayLayout]);
  const scrollTop = displayLayout.scrollTop ?? 0;

  const scrollSaveTimeoutRef = useRef<number | null>(null);
  const pendingScrollTopRef = useRef<number>(scrollTop);

  const saveScrollTop = useCallback((nextScrollTop: number): void => {
    pendingScrollTopRef.current = nextScrollTop;

    if (scrollSaveTimeoutRef.current !== null) {
      window.clearTimeout(scrollSaveTimeoutRef.current);
    }

    scrollSaveTimeoutRef.current = window.setTimeout(() => {
      scrollSaveTimeoutRef.current = null;
      const nextLayout = { ...displayLayoutRef.current, scrollTop: pendingScrollTopRef.current };
      setLayout(nextLayout);

      void (async (): Promise<void> => {
        try {
          await window.pixql.saveConnectionPickerLayout(nextLayout);
        } catch {
          // Scroll persistence should never block the app.
        }
      })();
    }, 150);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollSaveTimeoutRef.current !== null) {
        window.clearTimeout(scrollSaveTimeoutRef.current);
      }
    };
  }, []);

  const persistLayout = useCallback(
    (next: ConnectionPickerLayout): void => {
      if (scrollSaveTimeoutRef.current !== null) {
        window.clearTimeout(scrollSaveTimeoutRef.current);
        scrollSaveTimeoutRef.current = null;
      }

      const reconciled = reconcileConnectionPickerLayout(next, rawSections);
      setLayout(reconciled);

      void (async (): Promise<void> => {
        try {
          await window.pixql.saveConnectionPickerLayout(reconciled);
        } catch {
          // Layout persistence should never block the app.
        }
      })();
    },
    [rawSections]
  );

  const isCollapsed = useCallback(
    (groupKey: string): boolean => displayLayout.collapsedGroupIds.includes(groupKey),
    [displayLayout]
  );

  const toggleCollapsed = useCallback(
    (groupKey: string): void => {
      const collapsed = new Set(displayLayout.collapsedGroupIds);
      if (collapsed.has(groupKey)) {
        collapsed.delete(groupKey);
      } else {
        collapsed.add(groupKey);
      }
      persistLayout({
        ...displayLayout,
        collapsedGroupIds: [...collapsed]
      });
    },
    [displayLayout, persistLayout]
  );

  const reorderGroup = useCallback(
    (sourceKey: string, targetKey: string, side: ReorderSide): void => {
      persistLayout({
        ...displayLayout,
        groupOrder: reorderIds(displayLayout.groupOrder, sourceKey, targetKey, side)
      });
    },
    [displayLayout, persistLayout]
  );

  const reorderConnection = useCallback(
    (groupKey: string, sourceId: string, targetId: string, side: ReorderSide): void => {
      const order = displayLayout.connectionOrder[groupKey] ?? [];
      persistLayout({
        ...displayLayout,
        connectionOrder: {
          ...displayLayout.connectionOrder,
          [groupKey]: reorderIds(order, sourceId, targetId, side)
        }
      });
    },
    [displayLayout, persistLayout]
  );

  return {
    sections,
    isCollapsed,
    toggleCollapsed,
    reorderGroup,
    reorderConnection,
    scrollTop,
    saveScrollTop,
    loaded
  };
}

export type { GroupDropTarget, ConnectionDropTarget };
