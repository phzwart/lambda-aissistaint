export const unionRootSources = (claims) => {
  const roots = new Set();
  for (const claim of claims) {
    for (const hash of claim.root_sources ?? []) {
      roots.add(hash);
    }
  }
  return roots;
};

export const sharedAncestors = (claimA, claimB) => {
  const rootsA = new Set(claimA.root_sources ?? []);
  const shared = new Set();
  for (const hash of claimB.root_sources ?? []) {
    if (rootsA.has(hash)) {
      shared.add(hash);
    }
  }
  return shared;
};

const claimConfidence = (claim) => {
  const value = claim.confidence;
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

/**
 * Combine confidences accounting for shared ancestry.
 * Default policy lower_bound: shared roots cap at max confidence among inputs sharing those roots.
 */
export const combineConfidences = (claims, policy = 'lower_bound') => {
  const inputIds = claims.map((claim) => claim.claim_id);
  const sharedRoots = [...unionRootSources(claims)].filter((hash) => {
    let count = 0;
    for (const claim of claims) {
      if ((claim.root_sources ?? []).includes(hash)) {
        count += 1;
      }
    }
    return count > 1;
  });

  const numeric = claims
    .map(claimConfidence)
    .filter((value) => value !== null);

  if (!numeric.length) {
    return {
      confidence: null,
      shared_root_sources: sharedRoots,
      kind: 'derived',
      audit: {
        input_claim_ids: inputIds,
        shared_root_sources: sharedRoots,
        policy,
        note: 'no numeric confidences',
      },
    };
  }

  let combined;
  if (policy === 'lower_bound') {
    if (sharedRoots.length === 0) {
      combined = numeric.reduce((acc, value) => acc * value, 1);
    } else {
      const sharedClaims = claims.filter((claim) =>
        (claim.root_sources ?? []).some((hash) => sharedRoots.includes(hash)),
      );
      const sharedMax = Math.max(
        ...sharedClaims.map(claimConfidence).filter((value) => value !== null),
      );
      const disjoint = claims.filter(
        (claim) => !(claim.root_sources ?? []).some((hash) => sharedRoots.includes(hash)),
      );
      const disjointProduct = disjoint
        .map(claimConfidence)
        .filter((value) => value !== null)
        .reduce((acc, value) => acc * value, 1);
      combined = Math.min(1, sharedMax * (disjoint.length ? disjointProduct : 1));
    }
  } else {
    combined = Math.max(...numeric);
  }

  return {
    confidence: combined,
    shared_root_sources: sharedRoots,
    kind: 'derived',
    audit: {
      input_claim_ids: inputIds,
      shared_root_sources: sharedRoots,
      policy,
    },
  };
};

export const poison = (sourceHash, allClaims) =>
  allClaims.filter((claim) => (claim.root_sources ?? []).includes(sourceHash));

export const diffClaims = (claimsA, claimsB) => {
  const mapA = new Map(claimsA.map((claim) => [claim.claim_id, claim]));
  const mapB = new Map(claimsB.map((claim) => [claim.claim_id, claim]));
  const added = [];
  const removed = [];
  const changed = [];

  for (const [id, claim] of mapB) {
    if (!mapA.has(id)) {
      added.push(id);
    }
  }
  for (const [id, claim] of mapA) {
    if (!mapB.has(id)) {
      removed.push(id);
    }
  }
  for (const [id, left] of mapA) {
    const right = mapB.get(id);
    if (!right) {
      continue;
    }
    const fields = [];
    for (const field of ['text', 'confidence', 'provenance_kind']) {
      if (JSON.stringify(left[field]) !== JSON.stringify(right[field])) {
        fields.push(field);
      }
    }
    if (fields.length) {
      changed.push({ claim_id: id, fields });
    }
  }
  return { added, removed, changed };
};
