package store

import (
	"context"
	"testing"
)

func TestPersistCompletedSessionTurnReusesDuplicateLearningFactID(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	session, err := store.CreateSession(ctx, "python-learning")
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	fact := LearningFactInput{
		FactID:    "fact_dup_turn_key_test",
		LearnerID: "learner-dup-fact",
		Subject:   "Learner:learner-dup-fact",
		Predicate: "has_misconception",
		Object:    "Misconception:Concept:list",
	}

	first := conversationCompletedTurnInput(session.ID, "dup-fact-turn-1", 1, 1)
	first.LearnerID = "learner-dup-fact"
	first.Episode = &LearningEpisodeInput{}
	first.LearningFacts = []LearningFactInput{fact}
	if _, err := store.PersistCompletedSessionTurn(ctx, first); err != nil {
		t.Fatalf("persist first turn: %v", err)
	}

	second := conversationCompletedTurnInput(session.ID, "dup-fact-turn-2", 2, 2)
	second.LearnerID = "learner-dup-fact"
	second.Episode = &LearningEpisodeInput{}
	second.LearningFacts = []LearningFactInput{fact}
	if _, err := store.PersistCompletedSessionTurn(ctx, second); err != nil {
		t.Fatalf("persist second turn with duplicate fact id: %v", err)
	}

	var factRows int
	if err := store.db.QueryRow(`select count(*) from learning_facts where fact_id = ?`, fact.FactID).Scan(&factRows); err != nil {
		t.Fatalf("count learning facts: %v", err)
	}
	if factRows != 1 {
		t.Fatalf("learning_facts rows for duplicate fact id = %d, want 1", factRows)
	}
	var messageRows int
	if err := store.db.QueryRow(`select count(*) from messages where session_id = ?`, session.ID).Scan(&messageRows); err != nil {
		t.Fatalf("count messages: %v", err)
	}
	if messageRows != 4 {
		t.Fatalf("messages rows = %d, want 4 (both turns committed)", messageRows)
	}
}
