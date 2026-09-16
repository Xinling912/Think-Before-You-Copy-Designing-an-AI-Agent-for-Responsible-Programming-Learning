package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"responsible-edu-agent/services/api-gateway-go/internal/store"
)

const tokenChargeMinimumConfidence = 0.80

var tokenChargeReasonCodes = map[string]bool{
	"direct_solution_request":         true,
	"direct_code_completion_request":  true,
	"context_resolved_direct_request": true,
	"negated_direct_request":          false,
	"meta_direct_answer_question":     false,
	"ordinary_tutoring_request":       false,
	"casual_or_off_topic":             false,
	"deterministic_direct_request":    true,
	"deterministic_free_default":      false,
}

type tokenChargeDecisionRequest struct {
	Message        string              `json:"message"`
	RecentMessages []map[string]string `json:"recent_messages"`
	ActiveTopic    *string             `json:"active_topic"`
	SelectedNodeID *string             `json:"selected_node_id"`
}

type tokenChargeDecision struct {
	Chargeable     bool    `json:"chargeable"`
	ReasonCode     string  `json:"reason_code"`
	Confidence     float64 `json:"confidence"`
	DecisionSource string  `json:"decision_source"`
	Model          string  `json:"model"`
}

type tokenChargeEvidence struct {
	Chargeable     bool    `json:"chargeable"`
	ReasonCode     string  `json:"reason_code"`
	Confidence     float64 `json:"confidence"`
	DecisionSource string  `json:"decision_source"`
	Model          string  `json:"model"`
	ChargedTokens  int     `json:"charged_tokens"`
	DeliveryStatus string  `json:"delivery_status"`
}

func (g *Gateway) classifyTokenCharge(
	ctx context.Context,
	message string,
	recent []store.Message,
	projection store.ConversationProjectionRecord,
	requestedFocusNodeID string,
) (tokenChargeDecision, error) {
	message = strings.TrimSpace(message)
	if message == "" {
		return tokenChargeDecision{}, fmt.Errorf("token charge message is required")
	}
	if len(recent) > 8 {
		recent = recent[len(recent)-8:]
	}
	recentMessages := make([]map[string]string, 0, len(recent))
	for _, item := range recent {
		role := strings.TrimSpace(item.Role)
		content := strings.TrimSpace(item.Content)
		if (role != "student" && role != "agent") || content == "" {
			continue
		}
		recentMessages = append(recentMessages, map[string]string{"role": role, "content": content})
	}
	requestPayload := tokenChargeDecisionRequest{
		Message:        message,
		RecentMessages: recentMessages,
		ActiveTopic:    optionalTokenChargeString(stringValueFromMap(projection.Projection, "active_topic_id")),
		SelectedNodeID: optionalTokenChargeString(requestedFocusNodeID),
	}
	status, body, err := g.callAI(ctx, http.MethodPost, "/internal/token-charge/decision", requestPayload)
	if err != nil || status < http.StatusOK || status >= http.StatusMultipleChoices {
		return fallbackTokenChargeDecision(false, "deterministic_free_default"), nil
	}
	var decision tokenChargeDecision
	if err := json.Unmarshal(body, &decision); err != nil || !validTokenChargeDecision(decision) {
		return fallbackTokenChargeDecision(false, "deterministic_free_default"), nil
	}
	return decision, nil
}

func optionalTokenChargeString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func validTokenChargeDecision(decision tokenChargeDecision) bool {
	expectedChargeable, ok := tokenChargeReasonCodes[decision.ReasonCode]
	if !ok || decision.Chargeable != expectedChargeable {
		return false
	}
	if decision.Confidence < tokenChargeMinimumConfidence || decision.Confidence > 1 {
		return false
	}
	if decision.DecisionSource != "llm" && decision.DecisionSource != "deterministic_fallback" {
		return false
	}
	if strings.TrimSpace(decision.Model) == "" {
		return false
	}
	if strings.HasPrefix(decision.ReasonCode, "deterministic_") && decision.DecisionSource != "deterministic_fallback" {
		return false
	}
	if decision.DecisionSource == "deterministic_fallback" {
		switch decision.ReasonCode {
		case "deterministic_direct_request", "deterministic_free_default", "negated_direct_request", "meta_direct_answer_question":
		default:
			return false
		}
	}
	return true
}

func deterministicGatewayTokenChargeDecision(message string) tokenChargeDecision {
	normalized := strings.ToLower(strings.Join(strings.Fields(message), " "))
	negativePatterns := []string{
		`(?:不要|别)(?:再)?(?:给|告诉)(?:我)?(?:完整|正确|最终)?答案`,
		`不要(?:再)?直接(?:给(?:我)?)?(?:完整|正确|最终)?答案`,
		`不要(?:再)?直接(?:告诉)(?:我)?(?:完整|正确|最终)?答案`,
		`别直接(?:给(?:我)?|告诉(?:我)?)(?:完整|正确|最终)?答案`,
		`不需要(?:完整|正确|最终)?答案`,
		`只(?:要|给)(?:我)?(?:一个)?提示`,
		`不要(?:把|将).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)`,
		`别(?:把|将).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)`,
		`(?:不要|别)(?:再)?(?:帮我|替我|为我).{0,8}(?:写完|补全|完成).{0,8}(?:函数|代码)`,
		`(?:不要|别)(?:再)?(?:帮我|替我|为我).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)`,
		`do not (?:just )?give me (?:the )?(?:full |final |correct )?answer`,
		`don['’]t (?:just )?give me (?:the )?(?:full |final |correct )?answer`,
		`do not (?:finish|complete) (?:the|this|my)?\s*(?:function|code)`,
		`don['’]t (?:finish|complete) (?:the|this|my)?\s*(?:function|code)`,
		`no full answer`, `hint only`, `only (?:give me )?(?:a )?hint`,
	}
	metaPatterns := []string{
		`(?:你|系统|ai).{0,8}(?:会|能|可以).{0,8}(?:直接)?(?:给|告诉)(?:我)?.{0,6}(?:完整|正确|最终)?答案.{0,3}[吗么?？]`,
		`(?:你|系统|ai).{0,8}(?:会|能|可以).{0,8}直接(?:给|告诉).{0,6}答案.{0,3}[吗么?？]`,
		`can (?:you|the system|ai).{0,12}(?:give|provide).{0,12}direct answers?\??`,
		`(?:老师|他|她|别人).{0,8}(?:说|写).{0,4}[“"']?.{0,8}直接给答案`,
		`[“"']\s*(?:直接给答案|just give me the (?:final )?answer)\s*[”"']`,
		`[“"'].{0,40}(?:答案|函数|代码|answer|function|code).{0,40}[”"'].{0,12}(?:是什么意思|什么意思|意味着|mean)`,
	}
	directPatterns := []string{
		`直接(?:给(?:我)?|告诉(?:我)?|说)(?:这道题的|这个问题的)?(?:完整|正确|最终)?答案`,
		`(?:给|告诉)(?:我)?(?:这道题的|这个问题的)?(?:完整|正确|最终)答案`,
		`(?:这道题的|这个问题的)?(?:完整|正确|最终)?答案.{0,8}(?:给我|告诉我)`,
		`(?:帮我|把|替我).{0,12}(?:函数|代码).{0,8}(?:写完|补全|完成)`,
		`(?:写完|补全|完成).{0,8}(?:函数|代码).{0,4}(?:给我)?`,
		`just give me (?:the )?(?:full |final |correct )?answer`, `give me (?:the )?(?:full |final |correct )?answer`,
		`give me (?:the )?direct answer`, `give the direct answer`,
		`solve (?:this|the exercise|it) for me`,
		`complete (?:the|this|my)?\s*(?:function|code)(?: for me)?`,
		`finish (?:the|this|my)?\s*(?:function|code)(?: for me)?`,
	}
	if tokenChargeMatches(normalized, negativePatterns) {
		return fallbackTokenChargeDecision(false, "negated_direct_request")
	}
	if tokenChargeContainsQuotedCompletion(normalized, directPatterns) || tokenChargeMatches(normalized, metaPatterns) {
		return fallbackTokenChargeDecision(false, "meta_direct_answer_question")
	}
	if tokenChargeMatches(normalized, directPatterns) {
		return fallbackTokenChargeDecision(true, "deterministic_direct_request")
	}
	return fallbackTokenChargeDecision(false, "deterministic_free_default")
}

func tokenChargeContainsQuotedCompletion(message string, directPatterns []string) bool {
	quotePatterns := []string{`“([^”]+)”`, `"([^"]+)"`, `‘([^’]+)’`, `'([^']+)'`}
	for _, pattern := range quotePatterns {
		matches := regexp.MustCompile(pattern).FindAllStringSubmatch(message, -1)
		for _, match := range matches {
			if len(match) > 1 && tokenChargeMatches(match[1], directPatterns) {
				return true
			}
		}
	}
	return false
}

func tokenChargeMatches(message string, patterns []string) bool {
	for _, pattern := range patterns {
		if regexp.MustCompile(`(?i)` + pattern).MatchString(message) {
			return true
		}
	}
	return false
}

func fallbackTokenChargeDecision(chargeable bool, reasonCode string) tokenChargeDecision {
	return tokenChargeDecision{
		Chargeable: chargeable, ReasonCode: reasonCode, Confidence: 1,
		DecisionSource: "deterministic_fallback", Model: "deterministic-rules",
	}
}

func tokenChargeDecisionMap(decision tokenChargeDecision) map[string]any {
	return map[string]any{
		"chargeable": decision.Chargeable, "reason_code": decision.ReasonCode,
		"confidence": decision.Confidence, "decision_source": decision.DecisionSource, "model": decision.Model,
	}
}

func tokenChargeProjectionFromPayload(payload map[string]any, sessionID string, lastSequence int64) store.ConversationProjectionRecord {
	projection, _ := payload["conversation_projection"].(map[string]any)
	return store.ConversationProjectionRecord{
		SessionID: sessionID, LastSequence: lastSequence, Projection: projection,
	}
}

func writeTokenBudgetExhausted(response http.ResponseWriter, budget store.TokenBudget, decision tokenChargeDecision) {
	writeJSON(response, http.StatusTooManyRequests, map[string]any{
		"error":        "token_budget_exhausted",
		"message":      "Direct-answer token budget exhausted. Ordinary tutoring remains available.",
		"token_budget": budget, "token_charge_decision": tokenChargeDecisionMap(decision),
	})
}

func writeTokenBudgetExhaustedStream(response http.ResponseWriter, sessionID string, budget store.TokenBudget, decision tokenChargeDecision) {
	response.Header().Set("Content-Type", "application/x-ndjson")
	response.Header().Set("Cache-Control", "no-cache")
	response.Header().Set("X-Accel-Buffering", "no")
	response.WriteHeader(http.StatusOK)
	writeNDJSONEvent(response, map[string]any{
		"type": "trace_error", "session_id": sessionID, "turn_id": "", "failed_stage": "token_budget",
		"error_message": "Direct-answer token budget exhausted. Ordinary tutoring remains available.",
		"token_budget":  budget, "token_charge_decision": tokenChargeDecisionMap(decision),
	})
	if flusher, ok := response.(http.Flusher); ok {
		flusher.Flush()
	}
}

func prepareTokenDebit(
	decision tokenChargeDecision,
	participantID string,
	evidence map[string]any,
) (*store.TokenDebitInput, int) {
	chargedTokens := 0
	deliveryStatus := "not_chargeable"
	directAnswerGiven, _ := evidence["direct_answer_given"].(bool)
	contract, _ := evidence["direct_answer_contract"].(map[string]any)
	questionFree, _ := contract["question_free"].(bool)
	if decision.Chargeable && (!directAnswerGiven || !questionFree) {
		deliveryStatus = "not_delivered"
	}
	if decision.Chargeable && directAnswerGiven && questionFree {
		deliveryStatus = "delivered"
		chargedTokens = tokenUsageTotalFromEvidence(evidence)
		if chargedTokens < 0 {
			chargedTokens = 0
		}
	}
	evidence["token_charge_decision"] = map[string]any{
		"chargeable": decision.Chargeable, "reason_code": decision.ReasonCode,
		"confidence": decision.Confidence, "decision_source": decision.DecisionSource,
		"model": decision.Model, "charged_tokens": chargedTokens, "delivery_status": deliveryStatus,
	}
	if chargedTokens <= 0 {
		return nil, 0
	}
	scope := strings.TrimSpace(participantID)
	if scope == "" {
		scope = store.TokenBudgetScope
	}
	return &store.TokenDebitInput{Scope: scope, TotalTokens: chargedTokens}, chargedTokens
}
