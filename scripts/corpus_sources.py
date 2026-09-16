from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CorpusSource:
    source_id: str
    display_name: str
    start_url: str
    raw_dir: str
    processed_dir: str
    index_dir: str
    language: str
    license_note: str
    publish_full_text: bool


CORPUS_SOURCES: dict[str, CorpusSource] = {
    "python-docs-3.14.6": CorpusSource(
        source_id="python-docs-3.14.6",
        display_name="Python Official Documentation Tutorial and Glossary 3.14.6",
        start_url="https://docs.python.org/3/tutorial/index.html",
        raw_dir="data/raw/python-docs-3.14.6",
        processed_dir="data/processed/python-docs-3.14.6",
        index_dir="data/indexes/python-docs-3.14.6",
        language="en",
        license_note="python-software-foundation-documentation-license",
        publish_full_text=True,
    ),
    "think-python-2e": CorpusSource(
        source_id="think-python-2e",
        display_name="Think Python 2e HTML",
        start_url="https://greenteapress.com/thinkpython2/html/index.html",
        raw_dir="data/raw/think-python-2e",
        processed_dir="data/processed/think-python-2e",
        index_dir="data/indexes/think-python-2e",
        language="en",
        license_note="creative-commons-source",
        publish_full_text=True,
    ),
    "py4e-html3": CorpusSource(
        source_id="py4e-html3",
        display_name="Python for Everybody HTML3",
        start_url="https://www.py4e.com/html3/",
        raw_dir="data/raw/py4e-html3",
        processed_dir="data/processed/py4e-html3",
        index_dir="data/indexes/py4e-html3",
        language="en",
        license_note="creative-commons-source",
        publish_full_text=True,
    ),
    "runoob-python3": CorpusSource(
        source_id="runoob-python3",
        display_name="菜鸟教程 Python3 教程",
        start_url="https://www.runoob.com/python3/python3-tutorial.html",
        raw_dir="data/raw/runoob-python3",
        processed_dir="data/processed/runoob-python3",
        index_dir="data/indexes/runoob-python3",
        language="zh",
        license_note="private-development-full-copy",
        publish_full_text=True,
    ),
}


MULTISOURCE_INDEX_ID = "python-learning-multisource-v1"


def source_by_id(source_id: str) -> CorpusSource:
    try:
        return CORPUS_SOURCES[source_id]
    except KeyError as exc:
        raise ValueError(f"Unknown corpus source: {source_id}") from exc


def external_source_ids() -> list[str]:
    return ["think-python-2e", "py4e-html3", "runoob-python3"]


def all_source_ids() -> list[str]:
    return list(CORPUS_SOURCES)
