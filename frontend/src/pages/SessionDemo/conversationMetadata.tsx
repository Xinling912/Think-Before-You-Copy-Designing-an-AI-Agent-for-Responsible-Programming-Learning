import { Typography } from 'antd';
import type { ResponseContract, TurnResolution } from './model';

type Props = {
  turnResolution?: TurnResolution;
  responseContract?: ResponseContract;
  legacyAnswer?: string;
};

function metadataLines(contract: ResponseContract): string[] {
  const lines: string[] = [];
  if (contract.selected_node_usage !== 'absent' && contract.selected_node_label) {
    const notUsedSuffix = contract.selected_node_usage === 'not_used'
      ? ' · Not used for this response'
      : '';
    lines.push(`Selected Node: ${contract.selected_node_label}${notUsedSuffix}`);
  }
  if (contract.topic_transition) {
    lines.push(
      `Topic Transition: ${contract.topic_transition.from_label} → ${contract.topic_transition.to_label}`,
    );
  }
  if (contract.context_label && contract.context_summary) {
    lines.push(`${contract.context_label}: ${contract.context_summary}`);
  }
  return lines;
}

export function ConversationMetadata({
  turnResolution,
  responseContract,
  legacyAnswer = '',
}: Props) {
  if (!responseContract) {
    return legacyAnswer ? (
      <Typography.Paragraph className="learning-trace-answer">{legacyAnswer}</Typography.Paragraph>
    ) : null;
  }

  const lines = metadataLines(responseContract);
  return (
    <div
      className="learning-trace-conversation-response"
      data-conversation-relation={turnResolution?.conversation_relation}
    >
      {lines.length > 0 ? (
        <div className="learning-trace-conversation-metadata" data-testid="conversation-metadata">
          {lines.map((line) => <div key={line}>{line}</div>)}
        </div>
      ) : null}
      <Typography.Paragraph className="learning-trace-answer">
        {responseContract.answer_body}
      </Typography.Paragraph>
    </div>
  );
}
