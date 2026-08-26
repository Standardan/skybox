/**
 * Generic "apply a user's saved custom order on top of the provider's
 * order" merge, used for both category order and channel order within a
 * category. A saved order only ever needs to name items the user actually
 * touched by dragging — everything else falls back to the provider's own
 * order, appended after, rather than requiring a complete explicit list of
 * (potentially tens of thousands of) ids for every category up front.
 */
export function applyCustomOrder<T>(items: T[], getId: (item: T) => string, order: string[]): T[] {
  const byId = new Map(items.map((item) => [getId(item), item]));
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const id of order) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      ordered.push(item);
      seen.add(id);
    }
  }
  for (const item of items) {
    if (!seen.has(getId(item))) ordered.push(item);
  }
  return ordered;
}

/**
 * Computes the new explicit order array after dragging `movedId` to sit
 * just before `beforeId` (or to the end, if `beforeId` is null/absent from
 * `currentOrder`). `currentOrder` doesn't need to be complete — ids outside
 * it keep their relative provider order and are treated as coming after
 * every id already in `currentOrder`, matching applyCustomOrder above, so a
 * drag involving a never-before-touched item still produces a correct,
 * unambiguous explicit order forward.
 */
export function reorder(currentOrder: string[], allIdsInProviderOrder: string[], movedId: string, beforeId: string | null): string[] {
  const merged = applyCustomOrder(
    allIdsInProviderOrder.map((id) => ({ id })),
    (x) => x.id,
    currentOrder,
  ).map((x) => x.id);

  const without = merged.filter((id) => id !== movedId);
  const targetIndex = beforeId ? without.indexOf(beforeId) : -1;
  if (targetIndex === -1) {
    without.push(movedId);
  } else {
    without.splice(targetIndex, 0, movedId);
  }
  return without;
}
