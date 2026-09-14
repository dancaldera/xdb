import type { ConnectionPickerLayout } from "./types";

export const CONNECTION_PICKER_LAYOUT_STORAGE_KEY = "xdb:connection-picker:layout";
export const CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY = "xdb:connection-picker:collapsed";
export const UNGROUPED_SECTION_KEY = "__ungrouped__";

export type ConnectionGroupSectionLike = {
  group: { id: string } | null;
  connections: { id: string }[];
};

export type ReorderSide = "before" | "after";

export function connectionGroupSectionKey(section: ConnectionGroupSectionLike): string {
  return section.group?.id ?? UNGROUPED_SECTION_KEY;
}

export function reorderIds(order: string[], sourceId: string, targetId: string, side: ReorderSide): string[] {
  if (sourceId === targetId) {
    return order;
  }

  const nextOrder = order.filter((id) => id !== sourceId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (targetIndex === -1) {
    return order;
  }

  nextOrder.splice(side === "before" ? targetIndex : targetIndex + 1, 0, sourceId);
  return nextOrder;
}

export function createDefaultLayout(sections: ConnectionGroupSectionLike[]): ConnectionPickerLayout {
  return {
    collapsedGroupIds: [],
    groupOrder: sections.map((section) => connectionGroupSectionKey(section)),
    connectionOrder: Object.fromEntries(
      sections.map((section) => [
        connectionGroupSectionKey(section),
        section.connections.map((connection) => connection.id)
      ])
    )
  };
}

export function parseConnectionPickerLayout(value: unknown): ConnectionPickerLayout | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<ConnectionPickerLayout>;
  const collapsedGroupIds = Array.isArray(record.collapsedGroupIds)
    ? record.collapsedGroupIds.filter((item): item is string => typeof item === "string")
    : [];
  const groupOrder = Array.isArray(record.groupOrder)
    ? record.groupOrder.filter((item): item is string => typeof item === "string")
    : [];
  const connectionOrder: Record<string, string[]> = {};

  if (record.connectionOrder && typeof record.connectionOrder === "object") {
    for (const [key, ids] of Object.entries(record.connectionOrder)) {
      if (Array.isArray(ids)) {
        connectionOrder[key] = ids.filter((item): item is string => typeof item === "string");
      }
    }
  }

  const scrollTop =
    typeof record.scrollTop === "number" && Number.isFinite(record.scrollTop) ? record.scrollTop : undefined;

  return {
    collapsedGroupIds,
    groupOrder,
    connectionOrder,
    scrollTop
  };
}

function reconcileIdOrder(order: string[], validIds: string[]): string[] {
  const valid = new Set(validIds);
  const nextOrder = order.filter((id) => valid.has(id));

  for (const id of validIds) {
    if (!nextOrder.includes(id)) {
      nextOrder.push(id);
    }
  }

  return nextOrder;
}

export function reconcileConnectionPickerLayout(
  layout: ConnectionPickerLayout,
  sections: ConnectionGroupSectionLike[]
): ConnectionPickerLayout {
  const sectionKeys = sections.map((section) => connectionGroupSectionKey(section));
  const validSectionKeys = new Set(sectionKeys);

  const groupOrder = reconcileIdOrder(layout.groupOrder.length ? layout.groupOrder : sectionKeys, sectionKeys);

  const connectionOrder: Record<string, string[]> = {};
  for (const section of sections) {
    const sectionKey = connectionGroupSectionKey(section);
    const connectionIds = section.connections.map((connection) => connection.id);
    connectionOrder[sectionKey] = reconcileIdOrder(layout.connectionOrder[sectionKey] ?? [], connectionIds);
  }

  const collapsedGroupIds = layout.collapsedGroupIds.filter((key) => validSectionKeys.has(key));

  return {
    collapsedGroupIds,
    groupOrder,
    connectionOrder,
    scrollTop: layout.scrollTop
  };
}

export function applyConnectionPickerLayout<T extends ConnectionGroupSectionLike>(
  sections: T[],
  layout: ConnectionPickerLayout
): T[] {
  const sectionByKey = new Map(sections.map((section) => [connectionGroupSectionKey(section), section]));
  const orderedKeys = reconcileIdOrder(
    layout.groupOrder.length ? layout.groupOrder : sections.map((section) => connectionGroupSectionKey(section)),
    sections.map((section) => connectionGroupSectionKey(section))
  );

  return orderedKeys
    .map((key) => sectionByKey.get(key))
    .filter((section): section is T => section !== undefined)
    .map((section) => {
      const sectionKey = connectionGroupSectionKey(section);
      const connectionById = new Map(section.connections.map((connection) => [connection.id, connection]));
      const orderedConnectionIds = reconcileIdOrder(
        layout.connectionOrder[sectionKey] ?? [],
        section.connections.map((connection) => connection.id)
      );
      const connections = orderedConnectionIds
        .map((id) => connectionById.get(id))
        .filter((connection) => connection !== undefined);

      return {
        ...section,
        connections
      };
    });
}

export function layoutsEqual(left: ConnectionPickerLayout, right: ConnectionPickerLayout): boolean {
  if (left.collapsedGroupIds.length !== right.collapsedGroupIds.length) {
    return false;
  }

  for (let index = 0; index < left.collapsedGroupIds.length; index += 1) {
    if (left.collapsedGroupIds[index] !== right.collapsedGroupIds[index]) {
      return false;
    }
  }

  if (left.groupOrder.length !== right.groupOrder.length) {
    return false;
  }

  for (let index = 0; index < left.groupOrder.length; index += 1) {
    if (left.groupOrder[index] !== right.groupOrder[index]) {
      return false;
    }
  }

  const leftKeys = Object.keys(left.connectionOrder).sort();
  const rightKeys = Object.keys(right.connectionOrder).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  for (let index = 0; index < leftKeys.length; index += 1) {
    if (leftKeys[index] !== rightKeys[index]) {
      return false;
    }
    const key = leftKeys[index];
    const leftOrder = left.connectionOrder[key] ?? [];
    const rightOrder = right.connectionOrder[key] ?? [];
    if (leftOrder.length !== rightOrder.length) {
      return false;
    }
    for (let orderIndex = 0; orderIndex < leftOrder.length; orderIndex += 1) {
      if (leftOrder[orderIndex] !== rightOrder[orderIndex]) {
        return false;
      }
    }
  }

  if (left.scrollTop !== right.scrollTop) {
    return false;
  }

  return true;
}
