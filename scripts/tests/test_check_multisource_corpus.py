from scripts.check_multisource_corpus import reconstruct_section_text, validate_chunk_sequence


def test_reconstruct_section_text_matches_original_order():
    chunks = [
        {"chunk_index": 1, "text": "first"},
        {"chunk_index": 2, "text": "second"},
    ]
    assert reconstruct_section_text(chunks) == "first\n\nsecond"


def test_validate_chunk_sequence_rejects_missing_chunk_index():
    chunks = [
        {"chunk_index": 1, "text": "first"},
        {"chunk_index": 3, "text": "third"},
    ]
    try:
        validate_chunk_sequence("section-a", chunks)
    except AssertionError as exc:
        assert "section-a" in str(exc)
    else:
        raise AssertionError("validate_chunk_sequence should reject missing chunk index")
