import { LoadingOutlined } from '@ant-design/icons';
import { Collapse, Steps, Tag, Typography } from 'antd';
import { memo } from 'react';
import { KGPathMiniGraph } from '../../components/KGWorld/KGPathMiniGraph';
import { ConversationMetadata } from './conversationMetadata';
import type { KnowledgePathNode, LearningTrace, TraceStageKey, TraceStageStatusMap } from './model';
import { initialTraceStageStatus } from './model';

type Props = {
  trace?: LearningTrace;
  partialTrace?: Partial<LearningTrace>;
  stageStatus?: TraceStageStatusMap;
  answer?: string;
  onRequestFocus?: (node: KnowledgePathNode) => void;
};

function nodeLabel(nodeID: string) {
  return nodeID.split(':').pop()?.replace(/[_-]+/g, ' ') || nodeID;
}

function nodeFromID(nodeID: string): KnowledgePathNode {
  const [type] = nodeID.split(':');
  return {
    id: nodeID,
    label: nodeLabel(nodeID),
    type: type || 'Concept',
  };
}

function renderConceptTags(concepts: string[] | undefined) {
  return (concepts ?? []).map((concept) => (
    <Tag className="learning-trace-tag" key={concept}>
      {concept}
    </Tag>
  ));
}

function mergeTrace(trace?: LearningTrace, partialTrace?: Partial<LearningTrace>): Partial<LearningTrace> {
  return {
    ...(trace ?? {}),
    ...(partialTrace ?? {}),
    query_understanding: partialTrace?.query_understanding ?? trace?.query_understanding,
    kg_grounding: partialTrace?.kg_grounding ?? trace?.kg_grounding,
    rag_evidence: partialTrace?.rag_evidence ?? trace?.rag_evidence,
    teaching_decision: partialTrace?.teaching_decision ?? trace?.teaching_decision,
    turn_resolution: partialTrace?.turn_resolution ?? trace?.turn_resolution,
    response_contract: partialTrace?.response_contract ?? trace?.response_contract,
    answer: partialTrace?.answer ?? trace?.answer,
  };
}

function statusFor(stage: TraceStageKey, status?: TraceStageStatusMap, completedTrace?: LearningTrace) {
  if (status) {
    return status[stage];
  }
  return completedTrace ? 'finish' : initialTraceStageStatus()[stage];
}

function antStatus(
  stage: TraceStageKey,
  status?: TraceStageStatusMap,
  completedTrace?: LearningTrace,
): 'process' | 'error' | 'finish' | 'wait' {
  const value = statusFor(stage, status, completedTrace);
  if (value === 'running') {
    return 'process';
  }
  if (value === 'error') {
    return 'error';
  }
  if (value === 'finish') {
    return 'finish';
  }
  return 'wait';
}

function iconFor(stage: TraceStageKey, status?: TraceStageStatusMap, completedTrace?: LearningTrace) {
  return statusFor(stage, status, completedTrace) === 'running' ? <LoadingOutlined /> : undefined;
}

function shouldShowStage(stage: TraceStageKey, status?: TraceStageStatusMap, completedTrace?: LearningTrace) {
  if (completedTrace || !status) {
    return true;
  }
  return status[stage] !== 'waiting';
}

function QueryRewriteContent({ trace }: { trace: Partial<LearningTrace> }) {
  const query = trace.query_understanding;
  if (!query) {
    return <Typography.Text type="secondary">Rewriting the student question...</Typography.Text>;
  }
  return (
    <div className="learning-trace-kv">
      <span>Intent</span>
      <strong>{query.intent ?? 'unknown'}</strong>
      <span>Rewritten query</span>
      <strong>{query.rewritten_query ?? 'pending'}</strong>
      <span>Concept hints</span>
      <div>{renderConceptTags(query.concept_hints)}</div>
    </div>
  );
}

function fallbackPathView(trace: Partial<LearningTrace>) {
  const grounding = trace.kg_grounding;
  const nodeLookup = new Map<string, KnowledgePathNode>();
  for (const node of grounding?.nodes ?? []) {
    nodeLookup.set(node.id, node);
  }
  const toNodes = (ids: string[] | undefined) => (ids ?? []).map((id) => nodeLookup.get(id) ?? nodeFromID(id));
  const selectedPath = grounding?.paths?.[0];
  const path = selectedPath?.nodes ?? grounding?.selected_node_ids ?? [];
  return {
    path_id: selectedPath?.path_id,
    upstream: toNodes(grounding?.upstream ?? (path.length > 1 ? path.slice(0, 1) : [])),
    current: toNodes(grounding?.current ?? (path.length > 0 ? [path[Math.min(1, path.length - 1)]] : [])),
    downstream: toNodes(grounding?.downstream ?? (path.length > 2 ? path.slice(2) : [])),
    focus_node_ids: grounding?.current ?? (path.length > 0 ? [path[Math.min(1, path.length - 1)]] : []),
    edges: path.slice(0, -1).map((from, index) => ({
      from,
      to: path[index + 1],
      relation: selectedPath?.relations?.[index],
    })),
  };
}

function KGPathContent({
  trace,
  onRequestFocus,
}: {
  trace: Partial<LearningTrace>;
  onRequestFocus?: (node: KnowledgePathNode) => void;
}) {
  if (!trace.kg_grounding) {
    return <Typography.Text type="secondary">Searching the knowledge graph...</Typography.Text>;
  }
  const view = trace.kg_grounding.knowledge_path_view ?? fallbackPathView(trace);
  return (
    <KGPathMiniGraph
      pathView={view}
      pathID={view.path_id ?? trace.kg_grounding.paths?.[0]?.path_id}
      turnID={trace.turn_id}
      onRequestFocus={onRequestFocus}
    />
  );
}

function EvidenceContent({ trace }: { trace: Partial<LearningTrace> }) {
  if (!trace.rag_evidence) {
    return <Typography.Text type="secondary">Retrieving source evidence...</Typography.Text>;
  }
  const evidence = trace.rag_evidence;
  if (evidence.length === 0) {
    return <Typography.Text type="secondary">No source evidence is needed for this onboarding turn.</Typography.Text>;
  }
  return (
    <Collapse
      className="learning-trace-collapse nested"
      size="small"
      items={evidence.slice(0, 3).map((item) => ({
        key: String(item.rank),
        label: (
          <span className="learning-trace-evidence-label">
            <strong>
              {item.rank}. {item.title}
            </strong>
            {typeof item.score === 'number' ? <Tag>{item.score.toFixed(4)}</Tag> : null}
          </span>
        ),
        children: (
          <div className="learning-trace-evidence-body">
            {item.url ? (
              <a href={item.url} target="_blank" rel="noreferrer">
                {item.url}
              </a>
            ) : (
              <Typography.Text type="secondary">Source URL unavailable.</Typography.Text>
            )}
          </div>
        ),
      }))}
    />
  );
}

function LearningTraceMessage({
  trace,
  partialTrace,
  stageStatus,
  answer,
  onRequestFocus,
}: Props) {
  const mergedTrace = mergeTrace(trace, partialTrace);
  const completedTrace = trace;
  const finalAnswer = answer || mergedTrace.answer || '';
  const items = [
    shouldShowStage('query_understanding', stageStatus, completedTrace)
      ? {
          title: 'Query rewrite',
          status: antStatus('query_understanding', stageStatus, completedTrace),
          icon: iconFor('query_understanding', stageStatus, completedTrace),
          description: (
            <Collapse
              className="learning-trace-collapse"
              size="small"
              defaultActiveKey={antStatus('query_understanding', stageStatus, completedTrace) === 'process' ? ['query'] : undefined}
              items={[{
                key: 'query',
                label: 'Question understanding',
                children: <QueryRewriteContent trace={mergedTrace} />,
              }]}
            />
          ),
        }
      : undefined,
    shouldShowStage('kg_grounding', stageStatus, completedTrace)
      ? {
          title: 'Knowledge path',
          status: antStatus('kg_grounding', stageStatus, completedTrace),
          icon: iconFor('kg_grounding', stageStatus, completedTrace),
          description: (
            <Collapse
              className="learning-trace-collapse"
              size="small"
              items={[{
                key: 'kg',
                label: 'KG nodes and path',
                children: <KGPathContent trace={mergedTrace} onRequestFocus={onRequestFocus} />,
              }]}
            />
          ),
        }
      : undefined,
    shouldShowStage('rag_evidence', stageStatus, completedTrace)
      ? {
          title: 'Retrieved evidence',
          status: antStatus('rag_evidence', stageStatus, completedTrace),
          icon: iconFor('rag_evidence', stageStatus, completedTrace),
          description: (
            <Collapse
              className="learning-trace-collapse"
              size="small"
              items={[
                {
                  key: 'evidence',
                  label: `Top ${Math.min(3, mergedTrace.rag_evidence?.length ?? 3)} sources`,
                  children: <EvidenceContent trace={mergedTrace} />,
                },
              ]}
            />
          ),
        }
      : undefined,
    shouldShowStage('guided_response', stageStatus, completedTrace)
      ? {
          title: 'Guided response',
          status: antStatus('guided_response', stageStatus, completedTrace),
          icon: iconFor('guided_response', stageStatus, completedTrace),
          description: finalAnswer ? (
            <ConversationMetadata
              turnResolution={mergedTrace.turn_resolution}
              responseContract={mergedTrace.response_contract}
              legacyAnswer={finalAnswer}
            />
          ) : (
            <Typography.Text type="secondary">Preparing the guided response...</Typography.Text>
          ),
        }
      : undefined,
  ].filter((item) => item !== undefined);

  return (
    <div className="learning-trace-message">
      <Steps current={items.length - 1} direction="vertical" size="small" items={items} />
    </div>
  );
}

export default memo(LearningTraceMessage);
