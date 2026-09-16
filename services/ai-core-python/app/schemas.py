from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator, model_validator


TestQuestionFormat = Literal[
    "multiple_choice",
    "terminology",
    "syntax",
    "code_reading",
    "output_prediction",
    "fill_blank",
    "scenario",
    "debugging",
    "correction",
    "transfer",
]
NonEmptyText = Annotated[str, Field(min_length=1)]
TokenChargeReasonCode = Literal[
    "direct_solution_request",
    "direct_code_completion_request",
    "context_resolved_direct_request",
    "negated_direct_request",
    "meta_direct_answer_question",
    "ordinary_tutoring_request",
    "casual_or_off_topic",
    "deterministic_direct_request",
    "deterministic_free_default",
]


class StrictTestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TokenChargeRecentMessage(StrictTestModel):
    role: Literal["student", "agent"]
    content: NonEmptyText


class TokenChargeDecisionRequest(StrictTestModel):
    message: NonEmptyText
    recent_messages: list[TokenChargeRecentMessage] = Field(default_factory=list, max_length=8)
    active_topic: NonEmptyText | None = None
    selected_node_id: NonEmptyText | None = None


class TokenChargeDecisionResponse(StrictTestModel):
    chargeable: StrictBool
    reason_code: TokenChargeReasonCode
    confidence: float = Field(strict=True, ge=0.0, le=1.0)
    decision_source: Literal["llm", "deterministic_fallback"]
    model: NonEmptyText

    @model_validator(mode="after")
    def validate_decision_contract(self) -> "TokenChargeDecisionResponse":
        chargeable_reasons = {
            "direct_solution_request",
            "direct_code_completion_request",
            "context_resolved_direct_request",
            "deterministic_direct_request",
        }
        deterministic_reasons = {
            "deterministic_direct_request",
            "deterministic_free_default",
        }
        deterministic_source_reasons = {
            "deterministic_direct_request",
            "deterministic_free_default",
            "negated_direct_request",
            "meta_direct_answer_question",
        }
        if self.chargeable != (self.reason_code in chargeable_reasons):
            raise ValueError("chargeable must agree with reason_code")
        if (
            self.reason_code in deterministic_reasons
            and self.decision_source != "deterministic_fallback"
        ):
            raise ValueError("deterministic reason codes require deterministic_fallback source")
        if (
            self.decision_source == "deterministic_fallback"
            and self.reason_code not in deterministic_source_reasons
        ):
            raise ValueError("deterministic_fallback source cannot use an LLM-only reason code")
        return self


class TestTopic(StrictTestModel):
    id: NonEmptyText
    label: NonEmptyText
    summary: NonEmptyText
    icon: NonEmptyText


class TestQuestionGenerateRequest(StrictTestModel):
    catalog: list[TestTopic] = Field(min_length=20, max_length=20)
    selected_topic: TestTopic
    current_progress: int = Field(ge=0, le=9)
    level: int = Field(ge=1, le=10)
    difficulty_prompt: NonEmptyText
    recent_questions: list[NonEmptyText] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_catalog_selection_and_level(self) -> "TestQuestionGenerateRequest":
        topic_ids = [topic.id for topic in self.catalog]
        if len(set(topic_ids)) != 20:
            raise ValueError("catalog must contain twenty unique topic IDs")
        icon_keys = [topic.icon for topic in self.catalog]
        if len(set(icon_keys)) != 20:
            raise ValueError("catalog must contain twenty unique icon keys")
        matching_topic = next((topic for topic in self.catalog if topic.id == self.selected_topic.id), None)
        if matching_topic is None or matching_topic != self.selected_topic:
            raise ValueError("selected_topic must exactly match its catalog member")
        if self.level != self.current_progress + 1:
            raise ValueError("level must equal current_progress + 1")
        return self


class GeneratedTestQuestion(StrictTestModel):
    topic_id: NonEmptyText
    level: int = Field(ge=1, le=10)
    question_format: TestQuestionFormat
    question_text: NonEmptyText
    options: list[NonEmptyText] = Field(default_factory=list)
    expected_answer: NonEmptyText
    accepted_equivalents: list[NonEmptyText] = Field(default_factory=list)
    grading_rubric: list[NonEmptyText] = Field(default_factory=list)
    beginner_difficulty: StrictBool


class TestQuestionGenerationResponse(GeneratedTestQuestion):
    kg_grounding: dict[str, Any]
    provider: NonEmptyText
    model: NonEmptyText
    token_usage: dict[str, int | bool]


class TestJudgeRequest(StrictTestModel):
    topic_id: NonEmptyText
    level: int = Field(ge=1, le=10)
    question_format: TestQuestionFormat
    question_text: NonEmptyText
    options: list[NonEmptyText] = Field(default_factory=list)
    expected_answer: NonEmptyText
    accepted_equivalents: list[NonEmptyText] = Field(default_factory=list)
    grading_rubric: list[NonEmptyText] = Field(default_factory=list)
    student_answer: NonEmptyText


class TestJudgment(StrictTestModel):
    is_correct: StrictBool
    score: float = Field(ge=0.0, le=1.0)
    reason: NonEmptyText
    feedback: NonEmptyText


class TestJudgeResponse(TestJudgment):
    provider: NonEmptyText
    model: NonEmptyText
    token_usage: dict[str, int | bool]


class KGReasonRequest(BaseModel):
    target: str
    source: str | None = None


class RAGSearchRequest(BaseModel):
    query: str
    concepts: list[str] = Field(default_factory=list)
    top_k: int = 5
    source_ids: list[str] = Field(default_factory=list)
    index_name: str = "python-learning-multisource-v1"


class QueryUnderstandRequest(BaseModel):
    message: str
    allow_llm: bool = True


class SessionStepRequest(BaseModel):
    client_turn_id: str
    conversation_projection: dict[str, Any] = Field(default_factory=dict)
    learner_id: str | None = None
    session_id: str
    episode_id: int | None = None
    message: str
    stage: str = "start"
    baseline_mode: str = "full_memory"
    recent_messages: list[dict[str, str]] = Field(default_factory=list)
    task_state: dict[str, Any] = Field(default_factory=dict)
    last_evidence: dict[str, Any] = Field(default_factory=dict)
    learner_memory: list[dict[str, Any]] = Field(default_factory=list)
    topic_summaries: list[dict[str, Any]] = Field(default_factory=list)
    requested_focus_node_id: str | None = None
    token_charge_decision: TokenChargeDecisionResponse | None = None


class HarnessCompileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    suite_id: str = Field(min_length=1)
    scenario_id: str = ""
    natural_language_request: str = Field(min_length=1)

    @field_validator("suite_id", "natural_language_request")
    @classmethod
    def require_non_empty_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("field must not be empty")
        return stripped

    @field_validator("scenario_id")
    @classmethod
    def strip_optional_scenario_id(cls, value: str) -> str:
        return value.strip()


class HarnessTurn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: str
    content: str


class HarnessExpected(BaseModel):
    model_config = ConfigDict(extra="ignore")

    required_skills: list[str] = Field(default_factory=list)
    required_kg_nodes: list[str] = Field(default_factory=list)
    required_evidence: list[str] = Field(default_factory=list)
    forbidden_behaviors: list[str] = Field(default_factory=list)
    boundary_cases: list[str] = Field(default_factory=list)


class CompiledHarnessCase(BaseModel):
    model_config = ConfigDict(extra="ignore")

    schema_version: str = "harness.case.v1"
    case_id: str
    suite_id: str
    scenario_id: str = ""
    title: str
    natural_language_request: str
    turns: list[HarnessTurn]
    expected: HarnessExpected
    assertions: list[str] = Field(default_factory=list)


class HarnessCompileResponse(BaseModel):
    compiled_case: CompiledHarnessCase
    validator_errors: list[str] = Field(default_factory=list)
    model: str
    llm_used: bool
    llm_fallback: bool
    fallback_reason: str | None = None
