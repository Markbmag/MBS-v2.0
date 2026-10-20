/** The collection tree in display order. Pure; unit-tested in tests/library.test.ts. */
export interface TreeItem {
  id: number;
  parent_id: number | null;
}

export type TreeNode<T extends TreeItem = TreeItem> = T & { depth: number };

/** Items depth-first (in the order given), each with its depth; a missing parent puts an item at the top. */
export function flattenTree<T extends TreeItem>(collections: T[]): TreeNode<T>[] {
  const children = new Map<number | null, T[]>();
  const ids = new Set(collections.map((c) => c.id));
  for (const c of collections) {
    const parent = c.parent_id !== null && ids.has(c.parent_id) ? c.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), c]);
  }
  const out: TreeNode<T>[] = [];
  const visit = (parent: number | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      out.push({ ...c, depth });
      if (depth < 20) visit(c.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
