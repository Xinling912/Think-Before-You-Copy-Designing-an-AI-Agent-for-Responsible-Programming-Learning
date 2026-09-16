import json
from typing import Any

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from app.dashscope import DashScopeAPIError, DashScopeConfigurationError
from app.harness import compile_harness_case
from app.kg import build_kg_overview, reason_about_target
from app.kg_grounding import InvalidFocusNodeIdError, validate_requested_focus_node_id
from app.query_understanding import understand_query
from app.rag import RAGIndexNotReadyError, search_chunks
from app.schemas import (
    HarnessCompileRequest,
    KGReasonRequest,
    QueryUnderstandRequest,
    RAGSearchRequest,
    SessionStepRequest,
    TokenChargeDecisionRequest,
    TokenChargeDecisionResponse,
)
from app.session import iter_session_step_events, next_session_step
from app.schemas import TestJudgeRequest, TestJudgeResponse, TestQuestionGenerateRequest, TestQuestionGenerationResponse
from app.structured_output import StructuredOutputFailure
from app.test_center import generate_test_question, judge_test_answer
from app.token_charge_decision import decide_token_charge


app = FastAPI(title="ResponsibleEduAgent AI Core")


@app.post("/internal/token-charge/decision", response_model=TokenChargeDecisionResponse)
def internal_token_charge_decision(payload: Any = Body(default=None)):
    try:
        request = TokenChargeDecisionRequest.model_validate(payload)
    except ValidationError as exc:
        return _invalid_request_response("invalid_token_charge_request", exc)
    return decide_token_charge(request)


@app.post("/internal/tests/question", response_model=TestQuestionGenerationResponse)
def internal_test_question(payload: dict[str, Any]):
    try:
        request = TestQuestionGenerateRequest.model_validate(payload)
    except ValidationError as exc:
        return _invalid_request_response("invalid_test_question_request", exc)
    try:
        return generate_test_question(request)
    except StructuredOutputFailure as exc:
        return _structured_failure_response(exc)
    except (DashScopeAPIError, DashScopeConfigurationError) as exc:
        return _provider_failure_response(exc)


@app.post("/internal/tests/judge", response_model=TestJudgeResponse)
def internal_test_judge(payload: dict[str, Any]):
    try:
        request = TestJudgeRequest.model_validate(payload)
    except ValidationError as exc:
        return _invalid_request_response("invalid_test_judge_request", exc)
    try:
        return judge_test_answer(request)
    except StructuredOutputFailure as exc:
        return _structured_failure_response(exc)
    except (DashScopeAPIError, DashScopeConfigurationError) as exc:
        return _provider_failure_response(exc)


def _invalid_request_response(error: str, exc: ValidationError) -> JSONResponse:
    errors = []
    for item in exc.errors():
        location = ".".join(str(part) for part in item.get("loc", ()))
        message = str(item.get("msg") or "validation failed")
        errors.append(f"{location}: {message}" if location else message)
    return JSONResponse(
        status_code=400,
        content={"error": error, "validation_errors": errors},
    )


def _structured_failure_response(exc: StructuredOutputFailure) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": exc.error,
            "validation_errors": exc.validation_errors,
            "provider": exc.provider,
            "model": exc.model,
            "token_usage": exc.token_usage,
        },
    )


def _provider_failure_response(exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=502,
        content={
            "error": "provider_failed",
            "validation_errors": [],
            "provider": "dashscope",
            "model": "",
            "token_usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "usage_unavailable": True,
            },
            "message": str(exc),
        },
    )


@app.get("/ai/health")
def health() -> dict:
    return {"status": "ok", "service": "ai-core-python"}


@app.post("/ai/kg/reason")
def kg_reason(request: KGReasonRequest) -> dict:
    try:
        return reason_about_target(request.target, source=request.source)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/ai/kg/overview")
def kg_overview() -> dict:
    return build_kg_overview()


@app.post("/ai/rag/search")
def rag_search(request: RAGSearchRequest) -> dict:
    try:
        return search_chunks(
            request.query,
            concepts=request.concepts,
            top_k=request.top_k,
            source_ids=request.source_ids,
            index_name=request.index_name,
        )
    except RAGIndexNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (DashScopeAPIError, DashScopeConfigurationError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/ai/query/understand")
def query_understand(request: QueryUnderstandRequest) -> dict:
    result = understand_query(request.message, allow_llm=request.allow_llm)
    return {
        "intent": result.intent,
        "raw_message": result.raw_message,
        "retrieval_query": result.retrieval_query,
        "concept_hints": result.concept_hints,
        "needs_code": result.needs_code,
        "risk": result.risk,
        "llm_used": result.llm_used,
        "llm_fallback": result.llm_fallback,
        "chat_model": result.chat_model,
        "fallback_reason": result.fallback_reason,
        "route": result.route,
        "conversation_reply": result.conversation_reply,
    }


@app.post("/ai/harness/compile-case")
def harness_compile_case(request: HarnessCompileRequest) -> dict:
    return compile_harness_case(request).model_dump(mode="json")


@app.post("/ai/session/step")
def session_step(request: SessionStepRequest) -> dict:
    try:
        validate_requested_focus_node_id(request.requested_focus_node_id)
        return next_session_step(
            session_id=request.session_id,
            client_turn_id=request.client_turn_id,
            conversation_projection=request.conversation_projection,
            message=request.message,
            stage=request.stage,
            learner_id=request.learner_id,
            baseline_mode=request.baseline_mode,
            recent_messages=request.recent_messages,
            task_state=request.task_state,
            last_evidence=request.last_evidence,
            learner_memory=request.learner_memory,
            topic_summaries=request.topic_summaries,
            episode_id=request.episode_id,
            requested_focus_node_id=request.requested_focus_node_id,
            token_charge_decision=request.token_charge_decision,
        )
    except InvalidFocusNodeIdError as exc:
        return _invalid_focus_response(exc)
    except RAGIndexNotReadyError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (DashScopeAPIError, DashScopeConfigurationError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/ai/session/step/stream")
def session_step_stream(request: SessionStepRequest) -> Any:
    try:
        validate_requested_focus_node_id(request.requested_focus_node_id)
    except InvalidFocusNodeIdError as exc:
        return _invalid_focus_response(exc)

    def generate():
        try:
            for event in iter_session_step_events(
                session_id=request.session_id,
                client_turn_id=request.client_turn_id,
                conversation_projection=request.conversation_projection,
                message=request.message,
                stage=request.stage,
                learner_id=request.learner_id,
                baseline_mode=request.baseline_mode,
                recent_messages=request.recent_messages,
                task_state=request.task_state,
                last_evidence=request.last_evidence,
                learner_memory=request.learner_memory,
                topic_summaries=request.topic_summaries,
                episode_id=request.episode_id,
                requested_focus_node_id=request.requested_focus_node_id,
                token_charge_decision=request.token_charge_decision,
            ):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as exc:
            yield json.dumps(
                {
                    "type": "trace_error",
                    "session_id": request.session_id,
                    "turn_id": str(request.episode_id or ""),
                    "timestamp": "",
                    "failed_stage": "guided_response",
                    "error_message": str(exc),
                },
                ensure_ascii=False,
            ) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")


def _invalid_focus_response(exc: InvalidFocusNodeIdError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "error": "invalid_focus_node_id",
            "requested_focus_node_id": exc.requested_focus_node_id,
        },
    )
