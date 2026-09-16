import { describe, expect, test } from "vitest";
import {
  applyConnectionPickerLayout,
  CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY,
  type ConnectionGroupSectionLike,
  connectionGroupSectionKey,
  createDefaultLayout,
  reconcileConnectionPickerLayout,
  reorderIds,
  UNGROUPED_SECTION_KEY
} from "../src/shared/connection-picker-layout";

const GROUP_A = "group-a";
const GROUP_B = "group-b";
const CONN_1 = "conn-1";
const CONN_2 = "conn-2";
const CONN_3 = "conn-3";

function section(groupId: string | null, connectionIds: string[]): ConnectionGroupSectionLike {
  return {
    group: groupId ? { id: groupId } : null,
    connections: connectionIds.map((id) => ({ id }))
  };
}

const BASE_SECTIONS: ConnectionGroupSectionLike[] = [section(GROUP_A, [CONN_1, CONN_2]), section(GROUP_B, [CONN_3])];

describe("reorderIds", () => {
  test("moves an item before the target", () => {
    expect(reorderIds(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
  });

  test("moves an item after the target", () => {
    expect(reorderIds(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
  });

  test("returns the original order when source and target are the same", () => {
    expect(reorderIds(["a", "b"], "a", "a", "after")).toEqual(["a", "b"]);
  });
});

describe("reconcileConnectionPickerLayout", () => {
  test("preserves scrollTop", () => {
    const layout = createDefaultLayout(BASE_SECTIONS);
    layout.scrollTop = 42;

    const reconciled = reconcileConnectionPickerLayout(layout, BASE_SECTIONS);

    expect(reconciled.scrollTop).toBe(42);
  });

  test("appends new groups and connections at the end", () => {
    const layout = createDefaultLayout([section(GROUP_A, [CONN_1])]);
    const sections = [section(GROUP_A, [CONN_1, CONN_2]), section(GROUP_B, [CONN_3])];

    const reconciled = reconcileConnectionPickerLayout(layout, sections);

    expect(reconciled.groupOrder).toEqual([GROUP_A, GROUP_B]);
    expect(reconciled.connectionOrder[GROUP_A]).toEqual([CONN_1, CONN_2]);
    expect(reconciled.connectionOrder[GROUP_B]).toEqual([CONN_3]);
  });

  test("removes deleted groups and connections", () => {
    const layout = {
      collapsedGroupIds: [GROUP_A, "removed-group"],
      groupOrder: [GROUP_A, "removed-group", GROUP_B],
      connectionOrder: {
        [GROUP_A]: [CONN_1, "removed-conn"],
        removed: ["ghost"]
      }
    };
    const sections = BASE_SECTIONS;

    const reconciled = reconcileConnectionPickerLayout(layout, sections);

    expect(reconciled.groupOrder).toEqual([GROUP_A, GROUP_B]);
    expect(reconciled.collapsedGroupIds).toEqual([GROUP_A]);
    expect(reconciled.connectionOrder[GROUP_A]).toEqual([CONN_1, CONN_2]);
    expect(reconciled.connectionOrder.removed).toBeUndefined();
  });
});

describe("applyConnectionPickerLayout", () => {
  test("sorts sections and connections according to the layout", () => {
    const layout = {
      collapsedGroupIds: [],
      groupOrder: [GROUP_B, GROUP_A],
      connectionOrder: {
        [GROUP_A]: [CONN_2, CONN_1],
        [GROUP_B]: [CONN_3]
      }
    };

    const applied = applyConnectionPickerLayout(BASE_SECTIONS, layout);

    expect(applied.map((item) => connectionGroupSectionKey(item))).toEqual([GROUP_B, GROUP_A]);
    expect(applied[1]?.connections.map((connection) => connection.id)).toEqual([CONN_2, CONN_1]);
  });

  test("includes ungrouped sections using the ungrouped key", () => {
    const sections = [section(GROUP_A, [CONN_1]), section(null, [CONN_2])];
    const layout = {
      collapsedGroupIds: [],
      groupOrder: [UNGROUPED_SECTION_KEY, GROUP_A],
      connectionOrder: {
        [GROUP_A]: [CONN_1],
        [UNGROUPED_SECTION_KEY]: [CONN_2]
      }
    };

    const applied = applyConnectionPickerLayout(sections, layout);

    expect(applied.map((item) => connectionGroupSectionKey(item))).toEqual([UNGROUPED_SECTION_KEY, GROUP_A]);
  });

  test("keeps new connections that are missing from a saved order", () => {
    const layout = {
      collapsedGroupIds: [],
      groupOrder: [GROUP_A],
      connectionOrder: {
        [GROUP_A]: [CONN_2]
      }
    };

    const applied = applyConnectionPickerLayout([section(GROUP_A, [CONN_1, CONN_2])], layout);

    expect(applied[0]?.connections.map((connection) => connection.id)).toEqual([CONN_2, CONN_1]);
  });
});

describe("legacy storage keys", () => {
  test("exposes the legacy collapsed key constant for migration", () => {
    expect(CONNECTION_PICKER_COLLAPSED_LEGACY_STORAGE_KEY).toBe("xdb:connection-picker:collapsed");
  });
});
