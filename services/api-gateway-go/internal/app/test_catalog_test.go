package app

import (
	"go/ast"
	"go/parser"
	"go/token"
	"testing"
)

func TestTestCatalogContract(t *testing.T) {
	if len(testTopics) != 20 {
		t.Fatalf("topics = %d, want 20", len(testTopics))
	}
	ids, icons := map[string]bool{}, map[string]bool{}
	for _, topic := range testTopics {
		if topic.ID == "" || topic.Label == "" || topic.Summary == "" || topic.Icon == "" {
			t.Fatalf("incomplete topic: %#v", topic)
		}
		if ids[topic.ID] {
			t.Fatalf("duplicate topic id %q", topic.ID)
		}
		if icons[topic.Icon] {
			t.Fatalf("duplicate icon %q", topic.Icon)
		}
		ids[topic.ID], icons[topic.Icon] = true, true
	}
}

func TestTestCatalogLookup(t *testing.T) {
	want := TestTopic{
		ID:      "python_syntax_program_structure",
		Label:   "Python Syntax and Program Structure",
		Summary: "Basic Python program structure, indentation, statements, expressions, comments, input, output, and the rules that make Python code syntactically valid.",
		Icon:    "CodeOutlined",
	}
	got, ok := testTopicByID(want.ID)
	if !ok || got != want {
		t.Fatalf("testTopicByID(%q) = %#v, %v; want %#v, true", want.ID, got, ok, want)
	}
	if _, ok := testTopicByID("unknown"); ok {
		t.Fatal("unknown topic accepted")
	}
}

func TestTestDifficultyContract(t *testing.T) {
	seen := map[string]bool{}
	for score := 0; score < 10; score++ {
		level, prompt, ok := testDifficultyForScore(score)
		if !ok || level != score+1 || prompt == "" || seen[prompt] {
			t.Fatalf("invalid level for score %d", score)
		}
		seen[prompt] = true
	}
	if _, _, ok := testDifficultyForScore(-1); ok {
		t.Fatal("negative score accepted")
	}
	if _, _, ok := testDifficultyForScore(10); ok {
		t.Fatal("completed score accepted")
	}
}

func TestTestCatalogRejectsFixedQuestionBankIdentifiers(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "test_catalog.go", nil, 0)
	if err != nil {
		t.Fatalf("parse test_catalog.go: %v", err)
	}

	forbidden := map[string]bool{
		"QUESTION_BANK":    true,
		"FIXED_QUESTIONS":  true,
		"EXPECTED_ANSWERS": true,
		"questionBank":     true,
		"fixedQuestions":   true,
	}
	ast.Inspect(file, func(node ast.Node) bool {
		identifier, ok := node.(*ast.Ident)
		if ok && forbidden[identifier.Name] {
			t.Errorf("forbidden identifier %q in test_catalog.go", identifier.Name)
		}
		return true
	})
}
