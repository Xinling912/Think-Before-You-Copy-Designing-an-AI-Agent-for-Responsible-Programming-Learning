from scripts.corpus_sources import CORPUS_SOURCES, all_source_ids, source_by_id


def test_four_python_learning_sources_are_registered():
    assert set(CORPUS_SOURCES) == {
        "python-docs-3.14.6",
        "think-python-2e",
        "py4e-html3",
        "runoob-python3",
    }


def test_runoob_is_full_private_development_source():
    source = source_by_id("runoob-python3")
    assert source.raw_dir == "data/raw/runoob-python3"
    assert source.processed_dir == "data/processed/runoob-python3"
    assert source.index_dir == "data/indexes/runoob-python3"
    assert source.license_note == "private-development-full-copy"
    assert source.publish_full_text is True


def test_multisource_index_order_is_stable():
    assert all_source_ids() == [
        "python-docs-3.14.6",
        "think-python-2e",
        "py4e-html3",
        "runoob-python3",
    ]
