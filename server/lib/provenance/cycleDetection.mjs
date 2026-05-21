/** Returns error message if adding edges would create a cycle, else null. */
export const detectParentCycle = (parentMap, newClaimId, parentIds) => {
  const graph = new Map(parentMap);
  graph.set(newClaimId, parentIds ?? []);

  const visiting = new Set();
  const visited = new Set();

  const dfs = (node) => {
    if (visited.has(node)) {
      return false;
    }
    if (visiting.has(node)) {
      return true;
    }
    visiting.add(node);
    for (const parent of graph.get(node) ?? []) {
      if (dfs(parent)) {
        return true;
      }
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  for (const node of graph.keys()) {
    if (dfs(node)) {
      return `cycle detected involving claim ${newClaimId}`;
    }
  }
  return null;
};

export const computeRootSources = (claim, claimsById) => {
  const parents = claim.parent_claim_ids ?? [];
  if (!parents.length) {
    const hash = claim.source_span_id?.source_hash;
    return hash ? [hash] : [...(claim.root_sources ?? [])];
  }
  const roots = new Set();
  for (const parentId of parents) {
    const parent = claimsById.get(parentId);
    if (!parent) {
      continue;
    }
    for (const root of parent.root_sources ?? []) {
      roots.add(root);
    }
  }
  return [...roots];
};
