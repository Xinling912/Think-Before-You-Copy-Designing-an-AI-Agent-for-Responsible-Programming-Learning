package store

import (
	"bytes"
	"encoding/json"
)

func CompactEvidencePayload(payload map[string]any) (map[string]any, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var compact map[string]any
	if err := json.Unmarshal(encoded, &compact); err != nil {
		return nil, err
	}
	topLevelKG, hasTopLevelKG := compact["kg_grounding"]
	evidence, hasEvidence := compact["evidence"].(map[string]any)
	nestedKG, hasNestedKG := evidence["kg_grounding"]
	if !hasTopLevelKG || !hasEvidence || !hasNestedKG {
		return compact, nil
	}
	topLevelJSON, err := json.Marshal(topLevelKG)
	if err != nil {
		return nil, err
	}
	nestedJSON, err := json.Marshal(nestedKG)
	if err != nil {
		return nil, err
	}
	if bytes.Equal(topLevelJSON, nestedJSON) {
		delete(evidence, "kg_grounding")
	}
	return compact, nil
}
