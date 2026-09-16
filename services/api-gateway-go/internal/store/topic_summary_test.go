package store

import (
	"context"
	"testing"
)

func TestUpsertAndListTopicSummaries(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()

	first, err := store.UpsertTopicSummary(ctx, TopicSummaryInput{
		LearnerID:          "learner-topic",
		Topic:              "list_index_indexerror",
		Summary:            "Topic list_index_indexerror: weak concepts=[Concept:index].",
		WeakConcepts:       []string{"Concept:index"},
		MasteredConcepts:   []string{},
		NextTeachingAction: "Ask for the maximum valid index before explaining.",
		SourceSessionID:    "session-topic",
		SourceMemoryIDs:    []string{"memory-a"},
	})
	if err != nil {
		t.Fatalf("insert topic summary: %v", err)
	}
	if first.ID == 0 {
		t.Fatal("expected topic summary id")
	}

	second, err := store.UpsertTopicSummary(ctx, TopicSummaryInput{
		LearnerID:          "learner-topic",
		Topic:              "list_index_indexerror",
		Summary:            "Topic list_index_indexerror: weak concepts=[Concept:valid_index_range].",
		WeakConcepts:       []string{"Concept:valid_index_range"},
		MasteredConcepts:   []string{"Concept:index"},
		NextTeachingAction: "Use a transfer question after diagnostic feedback.",
		SourceSessionID:    "session-topic",
		SourceMemoryIDs:    []string{"memory-b"},
	})
	if err != nil {
		t.Fatalf("update topic summary: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected upsert to keep row id %d, got %d", first.ID, second.ID)
	}

	summaries, err := store.ListTopicSummaries(ctx, "learner-topic", 10)
	if err != nil {
		t.Fatalf("list topic summaries: %v", err)
	}
	if len(summaries) != 1 {
		t.Fatalf("expected 1 topic summary, got %d", len(summaries))
	}
	if summaries[0].WeakConcepts[0] != "Concept:valid_index_range" {
		t.Fatalf("expected updated weak concept, got %#v", summaries[0].WeakConcepts)
	}
	if summaries[0].MasteredConcepts[0] != "Concept:index" {
		t.Fatalf("expected mastered concept, got %#v", summaries[0].MasteredConcepts)
	}
	if summaries[0].NextTeachingAction != "Use a transfer question after diagnostic feedback." {
		t.Fatalf("unexpected next action: %q", summaries[0].NextTeachingAction)
	}
	if summaries[0].SourceMemoryIDs[0] != "memory-b" {
		t.Fatalf("expected updated source memory ids, got %#v", summaries[0].SourceMemoryIDs)
	}
}
