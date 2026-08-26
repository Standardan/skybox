import { describe, expect, it } from "vitest";
import { applyCustomOrder, reorder } from "./ordering.js";

describe("applyCustomOrder", () => {
  it("orders items by the saved order, appending anything not mentioned after, in original order", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    const result = applyCustomOrder(items, (x) => x.id, ["c", "a"]);
    expect(result.map((x) => x.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores saved-order ids that no longer exist in items", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const result = applyCustomOrder(items, (x) => x.id, ["stale-id", "b"]);
    expect(result.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("returns provider order unchanged when there's no saved order at all", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(applyCustomOrder(items, (x) => x.id, []).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("reorder", () => {
  it("moves an untouched item to sit just before another, on top of provider order", () => {
    // Nothing dragged yet (currentOrder empty) — provider order is a,b,c,d,e.
    // Drag "e" to just before "b".
    const result = reorder([], ["a", "b", "c", "d", "e"], "e", "b");
    expect(result).toEqual(["a", "e", "b", "c", "d"]);
  });

  it("moves an item to the end when beforeId is null", () => {
    const result = reorder([], ["a", "b", "c"], "a", null);
    expect(result).toEqual(["b", "c", "a"]);
  });

  it("builds correctly on top of a prior custom order, not just provider order", () => {
    // Previously moved "c" to the front: [c, a, b, d]. Now drag "d" to before "a".
    const result = reorder(["c", "a", "b"], ["a", "b", "c", "d"], "d", "a");
    expect(result).toEqual(["c", "d", "a", "b"]);
  });

  it("is a no-op reposition when dropped before its own current next neighbor", () => {
    const result = reorder([], ["a", "b", "c"], "a", "b");
    expect(result).toEqual(["a", "b", "c"]);
  });
});
