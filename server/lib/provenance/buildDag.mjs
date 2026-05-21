export const buildProvenanceDag = ({
  claims,
  spans,
  evidence,
  llmCalls = [],
  sourceHash,
  ingestId,
}) => {
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();

  const addNode = (node) => {
    if (nodeIds.has(node.id)) {
      return;
    }
    nodeIds.add(node.id);
    nodes.push(node);
  };

  for (const span of spans) {
    addNode({
      id: `span:${span.span_id}`,
      kind: 'source_span',
      source_hash: span.source_hash,
      span_id: span.span_id,
      chunk_index: span.chunk_index,
      char_start: span.char_start,
      char_end: span.char_end,
      page: span.page ?? null,
    });
  }

  for (const pass of evidence?.passes ?? []) {
    addNode({
      id: `step:${pass.extraction_step_id}`,
      kind: 'extraction_step',
      extraction_step_id: pass.extraction_step_id,
      ingest_id: ingestId,
    });
    for (const context of pass.contexts ?? []) {
      const contextNodeId = `ctx:${pass.extraction_step_id}:${context.context_index}`;
      addNode({
        id: contextNodeId,
        kind: 'source_span',
        source_hash: sourceHash,
        span_id: context.matched_span_id,
        citation: context.citation ?? null,
        context_index: context.context_index,
      });
      edges.push({
        from: contextNodeId,
        to: `step:${pass.extraction_step_id}`,
        relation: 'retrieved',
      });
      if (context.matched_span_id) {
        edges.push({
          from: `span:${context.matched_span_id}`,
          to: contextNodeId,
          relation: 'extracted_from',
        });
      }
    }
  }

  for (const call of llmCalls) {
    addNode({
      id: `llm:${call.call_id}`,
      kind: 'llm_call',
      call_id: call.call_id,
      extraction_step_id: call.extraction_step_id,
      model_alias: call.model_alias,
      prompt_hash: call.prompt_hash,
      response_hash: call.response_hash,
    });
    edges.push({
      from: `llm:${call.call_id}`,
      to: `step:${call.extraction_step_id}`,
      relation: 'retrieved',
    });
  }

  for (const claim of claims) {
    const stepId = claim.extraction_step_id;
    if (stepId) {
      addNode({
        id: `step:${stepId}`,
        kind: 'extraction_step',
        extraction_step_id: stepId,
        ingest_id: ingestId,
      });
    }
    addNode({
      id: `claim:${claim.claim_id}`,
      kind: 'parent_claim',
      claim_id: claim.claim_id,
      provenance_kind: claim.provenance_kind,
      text: claim.text,
    });
    if (claim.source_span_id?.span_id) {
      edges.push({
        from: `claim:${claim.claim_id}`,
        to: `span:${claim.source_span_id.span_id}`,
        relation: 'extracted_from',
      });
    }
    for (const parentId of claim.parent_claim_ids ?? []) {
      edges.push({
        from: `claim:${claim.claim_id}`,
        to: `claim:${parentId}`,
        relation: 'derived_from',
      });
    }
    edges.push({
      from: `claim:${claim.claim_id}`,
      to: `step:${claim.extraction_step_id}`,
      relation: 'retrieved',
    });
  }

  const rootSources = [
    ...new Set(claims.flatMap((claim) => claim.root_sources ?? [sourceHash])),
  ];

  return {
    ingest_id: ingestId,
    source_hash: sourceHash,
    root_sources: rootSources,
    nodes,
    edges,
  };
};

export const provenanceForClaim = (dag, claimId) => {
  if (!dag) {
    return null;
  }
  const claimNodeId = `claim:${claimId}`;
  const relatedNodes = new Set([claimNodeId]);
  const relatedEdges = [];

  const visitUpstream = (nodeId) => {
    for (const edge of dag.edges) {
      if (edge.from === nodeId) {
        relatedEdges.push(edge);
        if (!relatedNodes.has(edge.to)) {
          relatedNodes.add(edge.to);
          visitUpstream(edge.to);
        }
      }
    }
  };
  visitUpstream(claimNodeId);

  return {
    claim_id: claimId,
    root_sources: dag.root_sources ?? [],
    nodes: dag.nodes.filter((node) => relatedNodes.has(node.id)),
    edges: relatedEdges,
  };
};
