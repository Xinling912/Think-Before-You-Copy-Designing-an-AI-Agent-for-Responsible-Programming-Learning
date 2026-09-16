package store

import (
	"context"
	"strings"
	"testing"
)

func TestLearningEpisodeAndFactTemporalFields(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID:        "learner-graph",
		SessionID:        "session-graph",
		StudentMessageID: 101,
		AgentMessageID:   102,
		Topic:            "fractions",
		SkillState:       "needs_scaffold",
		Payload:          map[string]any{"strategy": "retrieval_first"},
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}
	if episode.ID == 0 {
		t.Fatal("expected episode id")
	}

	fact, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       "learner-graph",
		Subject:         "learner-graph",
		Predicate:       "struggles_with",
		Object:          "fraction_equivalence",
		Confidence:      0.82,
		SourceEpisodeID: episode.ID,
		Payload:         map[string]any{"evidence": "missed representation transfer"},
	})
	if err != nil {
		t.Fatalf("save learning fact: %v", err)
	}
	if fact.FactID == "" {
		t.Fatal("expected generated fact id")
	}
	if fact.ValidFrom.IsZero() {
		t.Fatal("expected valid_from to be populated")
	}
	if fact.Status != "active" {
		t.Fatalf("expected active fact, got %q", fact.Status)
	}

	facts, err := store.ListLearningFacts(ctx, "learner-graph")
	if err != nil {
		t.Fatalf("list learning facts: %v", err)
	}
	if len(facts) != 1 {
		t.Fatalf("expected 1 learning fact, got %d", len(facts))
	}
	if facts[0].FactID != fact.FactID {
		t.Fatalf("expected fact %q, got %q", fact.FactID, facts[0].FactID)
	}

	if _, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:  "learner-graph",
		Subject:    "learner-graph",
		Predicate:  "struggles_with",
		Object:     "ratio_reasoning",
		Confidence: 0.61,
	}); err == nil {
		t.Fatal("expected source episode id to be required")
	}
}

func TestUpdateLearningEpisodeMessagesAndPayload(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID:  "learner-episode",
		SessionID:  "session-episode",
		Topic:      "list_index_indexerror",
		SkillState: "started",
		Payload:    map[string]any{"baseline_mode": "full_memory"},
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}

	err = store.UpdateLearningEpisodeMessages(ctx, episode.ID, LearningEpisodeUpdate{
		StudentMessageID: 201,
		AgentMessageID:   202,
		Topic:            "list_index_indexerror",
		SkillState:       "hint_ladder",
		Payload: map[string]any{
			"skill_id":         "student-learning/progressive-hint-ladder",
			"memory_used":      true,
			"learning_fact_ct": 1,
		},
	})
	if err != nil {
		t.Fatalf("update learning episode: %v", err)
	}

	var studentMessageID int64
	var agentMessageID int64
	var skillState string
	var payloadJSON string
	if err := store.db.QueryRow(
		`select student_message_id, agent_message_id, skill_state, payload_json from learning_episodes where id = ?`,
		episode.ID,
	).Scan(&studentMessageID, &agentMessageID, &skillState, &payloadJSON); err != nil {
		t.Fatalf("query updated episode: %v", err)
	}
	if studentMessageID != 201 || agentMessageID != 202 {
		t.Fatalf("expected message ids 201/202, got %d/%d", studentMessageID, agentMessageID)
	}
	if skillState != "hint_ladder" {
		t.Fatalf("expected hint_ladder skill state, got %q", skillState)
	}
	if !strings.Contains(payloadJSON, "progressive-hint-ladder") {
		t.Fatalf("expected evidence payload in episode, got %s", payloadJSON)
	}

	episodes, err := store.ListLearningEpisodes(ctx, "learner-episode", 10)
	if err != nil {
		t.Fatalf("list learning episodes: %v", err)
	}
	if len(episodes) != 1 {
		t.Fatalf("expected one learning episode, got %d", len(episodes))
	}
	if episodes[0].ID != episode.ID {
		t.Fatalf("expected episode %d, got %d", episode.ID, episodes[0].ID)
	}
	if episodes[0].SkillState != "hint_ladder" {
		t.Fatalf("expected listed episode skill state hint_ladder, got %q", episodes[0].SkillState)
	}
	if episodes[0].Payload["skill_id"] != "student-learning/progressive-hint-ladder" {
		t.Fatalf("expected listed episode payload to include skill id, got %#v", episodes[0].Payload)
	}
}

func TestLearningGraphUpsertsEntitiesAndInvalidatesContradictedFacts(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	learnerID := "learner-kg"

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: learnerID,
		Topic:     "list_index_indexerror",
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}

	misconception, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.7,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save misconception fact: %v", err)
	}

	resolved, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "resolved_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.9,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save resolved misconception fact: %v", err)
	}

	allFacts, err := store.ListAllLearningFactsForTest(ctx, learnerID)
	if err != nil {
		t.Fatalf("list all learning facts: %v", err)
	}
	if len(allFacts) != 2 {
		t.Fatalf("expected 2 total facts, got %d", len(allFacts))
	}

	oldFact := requireFactByID(t, allFacts, misconception.FactID)
	if oldFact.Status != "invalidated" {
		t.Fatalf("expected old fact to be invalidated, got %q", oldFact.Status)
	}
	if oldFact.ValidTo.IsZero() {
		t.Fatal("expected invalidated fact valid_to to be populated")
	}

	newFact := requireFactByID(t, allFacts, resolved.FactID)
	if newFact.Status != "active" {
		t.Fatalf("expected resolved fact to be active, got %q", newFact.Status)
	}

	activeFacts, err := store.ListLearningFacts(ctx, learnerID)
	if err != nil {
		t.Fatalf("list active learning facts: %v", err)
	}
	if len(activeFacts) != 1 {
		t.Fatalf("expected 1 active fact, got %d", len(activeFacts))
	}
	if activeFacts[0].FactID != resolved.FactID {
		t.Fatalf("expected active fact %q, got %q", resolved.FactID, activeFacts[0].FactID)
	}

	entities, err := store.ListLearningEntities(ctx, learnerID)
	if err != nil {
		t.Fatalf("list learning entities: %v", err)
	}
	if !hasLearningEntityType(entities, "Learner") {
		t.Fatalf("expected Learner entity, got %#v", entities)
	}
	if !hasLearningEntityType(entities, "Misconception") {
		t.Fatalf("expected Misconception entity, got %#v", entities)
	}
}

func TestLearningGraphMasteryInvalidatesMisconceptionFact(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	learnerID := "learner-mastery"

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: learnerID,
		Topic:     "list_index_indexerror",
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}

	misconception, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.76,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save misconception fact: %v", err)
	}

	mastery, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_mastery",
		Object:          "Mastery:list_index_indexerror",
		Confidence:      0.81,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save mastery fact: %v", err)
	}

	allFacts, err := store.ListAllLearningFactsForTest(ctx, learnerID)
	if err != nil {
		t.Fatalf("list all learning facts: %v", err)
	}
	oldFact := requireFactByID(t, allFacts, misconception.FactID)
	if oldFact.Status != "invalidated" {
		t.Fatalf("expected misconception fact to be invalidated, got %q", oldFact.Status)
	}
	if oldFact.ValidTo.IsZero() {
		t.Fatal("expected invalidated misconception valid_to to be populated")
	}

	newFact := requireFactByID(t, allFacts, mastery.FactID)
	if newFact.Status != "active" {
		t.Fatalf("expected mastery fact to be active, got %q", newFact.Status)
	}
}

func TestSaveLearningFactRejectsEmptyRequiredFields(t *testing.T) {
	tests := []struct {
		name        string
		input       LearningFactInput
		expectedErr string
	}{
		{
			name: "subject",
			input: LearningFactInput{
				Subject:   "   ",
				Predicate: "has_misconception",
				Object:    "Misconception:list_index_indexerror",
			},
			expectedErr: "learning fact subject is required",
		},
		{
			name: "predicate",
			input: LearningFactInput{
				Subject:   "Learner:learner-validation",
				Predicate: "\t",
				Object:    "Misconception:list_index_indexerror",
			},
			expectedErr: "learning fact predicate is required",
		},
		{
			name: "object",
			input: LearningFactInput{
				Subject:   "Learner:learner-validation",
				Predicate: "has_misconception",
				Object:    "\n",
			},
			expectedErr: "learning fact object is required",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := openTestStore(t)
			ctx := context.Background()
			learnerID := "learner-validation-" + test.name

			episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
				LearnerID: learnerID,
				Topic:     "list_index_indexerror",
			})
			if err != nil {
				t.Fatalf("save learning episode: %v", err)
			}

			input := test.input
			input.LearnerID = learnerID
			input.SourceEpisodeID = episode.ID
			input.Confidence = 0.8

			_, err = store.SaveLearningFact(ctx, input)
			if err == nil {
				t.Errorf("expected %q error, got nil", test.expectedErr)
			} else if err.Error() != test.expectedErr {
				t.Errorf("expected %q error, got %q", test.expectedErr, err.Error())
			}

			facts, err := store.ListAllLearningFactsForTest(ctx, learnerID)
			if err != nil {
				t.Fatalf("list all learning facts: %v", err)
			}
			if len(facts) != 0 {
				t.Errorf("expected no facts after invalid input, got %#v", facts)
			}

			entities, err := store.ListLearningEntities(ctx, learnerID)
			if err != nil {
				t.Fatalf("list learning entities: %v", err)
			}
			if len(entities) != 0 {
				t.Errorf("expected no entities after invalid input, got %#v", entities)
			}
		})
	}
}

func TestLearningGraphMisconceptionInvalidatesLowerConfidenceResolvedFact(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	learnerID := "learner-confidence-invalidates"

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: learnerID,
		Topic:     "list_index_indexerror",
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}

	resolved, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "resolved_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.72,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save resolved misconception fact: %v", err)
	}

	misconception, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.72,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save misconception fact: %v", err)
	}

	allFacts, err := store.ListAllLearningFactsForTest(ctx, learnerID)
	if err != nil {
		t.Fatalf("list all learning facts: %v", err)
	}
	resolvedFact := requireFactByID(t, allFacts, resolved.FactID)
	if resolvedFact.Status != "invalidated" {
		t.Fatalf("expected lower-confidence resolved fact to be invalidated, got %q", resolvedFact.Status)
	}
	if resolvedFact.ValidTo.IsZero() {
		t.Fatal("expected invalidated resolved fact valid_to to be populated")
	}

	misconceptionFact := requireFactByID(t, allFacts, misconception.FactID)
	if misconceptionFact.Status != "active" {
		t.Fatalf("expected new misconception fact to be active, got %q", misconceptionFact.Status)
	}
}

func TestLearningGraphMisconceptionInvalidatesHigherConfidenceResolvedFactToPreventContradiction(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	learnerID := "learner-confidence-no-contradiction"

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: learnerID,
		Topic:     "list_index_indexerror",
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}

	resolved, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "resolved_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.9,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save resolved misconception fact: %v", err)
	}

	misconception, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.7,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save misconception fact: %v", err)
	}

	allFacts, err := store.ListAllLearningFactsForTest(ctx, learnerID)
	if err != nil {
		t.Fatalf("list all learning facts: %v", err)
	}
	resolvedFact := requireFactByID(t, allFacts, resolved.FactID)
	if resolvedFact.Status != "invalidated" {
		t.Fatalf("expected higher-confidence resolved fact to be invalidated, got %q", resolvedFact.Status)
	}
	if resolvedFact.ValidTo.IsZero() {
		t.Fatal("expected invalidated resolved fact valid_to to be populated")
	}

	misconceptionFact := requireFactByID(t, allFacts, misconception.FactID)
	if misconceptionFact.Status != "active" {
		t.Fatalf("expected lower-confidence misconception fact to be active, got %q", misconceptionFact.Status)
	}

	activeFacts, err := store.ListLearningFacts(ctx, learnerID)
	if err != nil {
		t.Fatalf("list active learning facts: %v", err)
	}
	if len(activeFacts) != 1 || activeFacts[0].FactID != misconception.FactID {
		t.Fatalf("expected only the new misconception fact to stay active, got %#v", activeFacts)
	}
}

func TestLearningGraphMisconceptionInvalidatesExistingMasteryFact(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	learnerID := "learner-mastery-no-contradiction"

	episode, err := store.SaveLearningEpisode(ctx, LearningEpisodeInput{
		LearnerID: learnerID,
		Topic:     "list_index_indexerror",
	})
	if err != nil {
		t.Fatalf("save learning episode: %v", err)
	}

	mastery, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_mastery",
		Object:          "Mastery:list_index_indexerror",
		Confidence:      0.9,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save mastery fact: %v", err)
	}

	misconception, err := store.SaveLearningFact(ctx, LearningFactInput{
		LearnerID:       learnerID,
		Subject:         "Learner:" + learnerID,
		Predicate:       "has_misconception",
		Object:          "Misconception:list_index_indexerror",
		Confidence:      0.75,
		SourceEpisodeID: episode.ID,
	})
	if err != nil {
		t.Fatalf("save misconception fact: %v", err)
	}

	allFacts, err := store.ListAllLearningFactsForTest(ctx, learnerID)
	if err != nil {
		t.Fatalf("list all learning facts: %v", err)
	}
	masteryFact := requireFactByID(t, allFacts, mastery.FactID)
	if masteryFact.Status != "invalidated" {
		t.Fatalf("expected mastery fact to be invalidated, got %q", masteryFact.Status)
	}
	if masteryFact.ValidTo.IsZero() {
		t.Fatal("expected invalidated mastery valid_to to be populated")
	}

	misconceptionFact := requireFactByID(t, allFacts, misconception.FactID)
	if misconceptionFact.Status != "active" {
		t.Fatalf("expected misconception fact to be active, got %q", misconceptionFact.Status)
	}
}

func requireFactByID(t *testing.T, facts []LearningFact, factID string) LearningFact {
	t.Helper()

	for _, fact := range facts {
		if fact.FactID == factID {
			return fact
		}
	}
	t.Fatalf("expected fact %q in %#v", factID, facts)
	return LearningFact{}
}

func hasLearningEntityType(entities []LearningEntity, entityType string) bool {
	for _, entity := range entities {
		if entity.EntityType == entityType {
			return true
		}
	}
	return false
}
