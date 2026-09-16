import { useMemo, useState } from 'react';
import studentQuestionIllustration from '../../assets/dashboard/student-question.svg';
import goGatewayIllustration from '../../assets/dashboard/go-gateway.svg';
import queryRewriteIllustration from '../../assets/dashboard/query-rewrite.svg';
import kgGroundingIllustration from '../../assets/dashboard/kg-grounding.svg';
import ragEvidenceIllustration from '../../assets/dashboard/rag-evidence.svg';
import pedagogicalPolicyIllustration from '../../assets/dashboard/pedagogical-policy.svg';
import guidedReplyIllustration from '../../assets/dashboard/guided-reply.svg';
import evidenceMemoryIllustration from '../../assets/dashboard/evidence-memory.svg';

type Stage = {
  title: string;
  shortTitle: string;
  image: string;
  summary: string;
  upstream: string;
  work: string;
  downstream: string;
  decision: string;
};

const proofCards = [
  {
    title: 'No direct answer first',
    body: 'The first move asks the learner to inspect intent, error line, confidence, or a small attempt before revealing a final fix.',
  },
  {
    title: 'Source-grounded explanation',
    body: 'The reply is constrained by KG grounding and RAG evidence from Python learning sources, not just free-form chat.',
  },
  {
    title: 'Learning evidence recorded',
    body: 'Each turn persists teaching decisions, source traces, hint level, direct-answer flags, and memory updates.',
  },
];

const stages: Stage[] = [
  {
    title: 'Student question',
    shortTitle: 'Student',
    image: studentQuestionIllustration,
    summary: 'A beginner asks a concrete Python debugging or concept question in the learning chat.',
    upstream: 'The learner opens /session-demo and submits a concrete Python question, often with an error message, code fragment, or concept confusion.',
    work: 'The system treats the message as a learning episode and checks whether a direct answer would bypass student reasoning.',
    downstream: 'The message is sent to /api/session/message so the gateway can attach session, memory, and topic context.',
    decision: 'Open a guided episode before giving away the answer.',
  },
  {
    title: 'Go Gateway',
    shortTitle: 'Gateway',
    image: goGatewayIllustration,
    summary: 'The Go service receives /api/session/message and builds the session context.',
    upstream: 'The frontend posts the learner message, session identity, and current turn payload.',
    work: 'Go creates or reads the session, loads recent dialogue, learner memory, topic summaries, and starts a learning episode.',
    downstream: 'It forwards the enriched request to Python AI Core, then persists the student turn, reply, evidence, and memory updates to SQLite.',
    decision: 'Keep the teaching loop observable and durable.',
  },
  {
    title: 'Query understanding',
    shortTitle: 'Rewrite',
    image: queryRewriteIllustration,
    summary: 'Python AI Core interprets the learner message before retrieval or generation.',
    upstream: 'Python AI Core receives the learner message plus session context from the gateway.',
    work: 'It classifies intent, rewrites the retrieval query, extracts concept hints, and flags direct-answer dependency risk.',
    downstream: 'The rewritten query and concept hints become the input for knowledge-graph grounding.',
    decision: 'Transform a raw question into a teachable search and policy state.',
  },
  {
    title: 'KG grounding',
    shortTitle: 'KG',
    image: kgGroundingIllustration,
    summary: 'The question is anchored to a Python concept path instead of being answered in isolation.',
    upstream: 'Intent and concept hints identify that the learner is struggling with list indexing.',
    work: 'The system searches source-backed KG candidates, selects the most relevant node IDs, computes a shortest learning path, and returns path edges, topic metadata, confidence, and a gap flag.',
    downstream: 'The selected KG path and candidate nodes guide retrieval, response planning, and evidence logging without hard-coding a single example path.',
    decision: 'Teach through the concept path behind the error.',
  },
  {
    title: 'RAG evidence',
    shortTitle: 'RAG',
    image: ragEvidenceIllustration,
    summary: 'The rewritten query and KG path retrieve source-grounded learning evidence.',
    upstream: 'The retriever receives the rewritten query together with the grounded concept path.',
    work: 'It searches Python docs, Think Python, PY4E, Runoob Python3, FAISS recall, and DashScope rerank results.',
    downstream: 'Selected chunks, source URLs, scores, rerank scores, and concepts constrain the guided reply.',
    decision: 'Answer from evidence, not from a bare model guess.',
  },
  {
    title: 'Pedagogical policy',
    shortTitle: 'Policy',
    image: pedagogicalPolicyIllustration,
    summary: 'Teaching skills decide what the agent is allowed to say next.',
    upstream: 'The policy layer receives intent, KG path, retrieved evidence, memory state, and recent dialogue.',
    work: 'It selects teaching moves such as retrieve-first gate, confidence calibration, stuck/error coaching, hint ladder, or teach-back.',
    downstream: 'It sets constraints including allow_direct_answer, requires_student_attempt, active skill, and hint level for generation.',
    decision: 'Choose a teaching move before generating language.',
  },
  {
    title: 'Guided reply',
    shortTitle: 'Reply',
    image: guidedReplyIllustration,
    summary: 'Qwen generates a short teaching response under responsible constraints.',
    upstream: 'Generation receives the student input, policy constraints, concept path, evidence snippets, and recent dialogue.',
    work: 'Qwen writes a short Chinese tutoring response that responds to the current learner turn and avoids repeating the previous prompt.',
    downstream: 'The reply is returned to the frontend while the decision trace is prepared for evidence logging.',
    decision: 'Produce a helpful next step without short-circuiting learning.',
  },
  {
    title: 'Evidence logging & memory',
    shortTitle: 'Evidence',
    image: evidenceMemoryIllustration,
    summary: 'The system records what happened and updates the learner state.',
    upstream: 'The completed turn contains the learner message, generated reply, policy decisions, KG path, and retrieved sources.',
    work: 'The system logs intent, rewritten query, RAG sources, active skill, direct-answer flags, hint level, teach-back state, and memory updates.',
    downstream: 'The next turn can continue from short-term dialogue, task state, learner memory, topic summaries, and learning facts.',
    decision: 'Make the teaching decision inspectable and reusable.',
  },
];

function getPreviousIndex(index: number) {
  return (index - 1 + stages.length) % stages.length;
}

function getNextIndex(index: number) {
  return (index + 1) % stages.length;
}

export default function DashboardPage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const activeStage = stages[activeIndex];
  const stageNumber = useMemo(() => String(activeIndex + 1).padStart(2, '0'), [activeIndex]);

  return (
    <main className="dashboard-poster" aria-label="ResponsibleEduAgent visual companion">
      <section className="dashboard-poster-top">
        <div className="dashboard-positioning">
          <div className="dashboard-mark">ResponsibleEduAgent</div>
          <h1>ResponsibleEduAgent: a Python learning agent that teaches without giving away the answer.</h1>
          <p>
            A responsible learning agent for Python beginners: it prompts student thinking first, then advances understanding with
            evidence, knowledge paths, and teaching skills.
          </p>
        </div>

        <div className="dashboard-proof-grid" aria-label="Why responsible">
          {proofCards.map((card, index) => (
            <article className="dashboard-proof-card" key={card.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="dashboard-stage-card" aria-live="polite">
        <div className="dashboard-stage-controls" aria-label="Stage controls">
          <button type="button" onClick={() => setActiveIndex(getPreviousIndex(activeIndex))} aria-label="Previous stage">
            Prev
          </button>
          <button type="button" onClick={() => setActiveIndex(getNextIndex(activeIndex))} aria-label="Next stage">
            Next
          </button>
        </div>

        <div className="dashboard-stage-copy">
          <div className="dashboard-stage-meta">
            <span>Stage {stageNumber} / 08</span>
            <span>{activeStage.shortTitle}</span>
          </div>
          <h2>{activeStage.title}</h2>
          <p className="dashboard-stage-summary">{activeStage.summary}</p>
          <div className="dashboard-stage-flow">
            <article>
              <span>Upstream</span>
              <p>{activeStage.upstream}</p>
            </article>
            <article>
              <span>This stage</span>
              <p>{activeStage.work}</p>
            </article>
            <article>
              <span>Downstream</span>
              <p>{activeStage.downstream}</p>
            </article>
          </div>
          <div className="dashboard-stage-decision">
            <span>Teaching decision</span>
            <strong>{activeStage.decision}</strong>
          </div>
        </div>

        <figure className="dashboard-stage-art">
          <img src={activeStage.image} alt={`${activeStage.title} flow diagram`} />
        </figure>
      </section>

      <section className="dashboard-navigation" aria-label="Agent flow controls">
        <div className="dashboard-step-dots" aria-label="Agent flow stages">
          {stages.map((stage, index) => {
            const number = String(index + 1).padStart(2, '0');
            const isActive = index === activeIndex;
            return (
              <button
                type="button"
                key={stage.title}
                aria-label={`Jump to ${stage.title}`}
                aria-current={isActive ? 'step' : undefined}
                className={isActive ? 'active' : ''}
                onClick={() => setActiveIndex(index)}
              >
                {number}
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
