from scripts.corpus_sources import source_by_id
from scripts.extract_multisource_corpus import clean_section_text, extract_source_sections_from_html, split_chunk_text


def test_clean_section_text_preserves_code_order():
    raw = "Paragraph one\n```python\n>>> x = [1, 2]\n>>> x[0]\n1\n```\nParagraph two"
    assert clean_section_text(raw) == raw


def test_split_chunk_text_preserves_reconstruction():
    text = "A" * 1300 + "\n\n```python\nprint('hello')\n```\n\n" + "B" * 1300
    chunks = split_chunk_text(text, max_chars=1500)
    assert "\n\n".join(chunks) == text
    assert len(chunks) == 2


def test_runoob_extractor_drops_user_notes_and_comments():
    html = """
    <div class="article-intro" id="content">
      <h1>Python3 列表</h1>
      <p>列表是 Python 中最基本的数据结构。</p>
      <pre>list1 = ['Google', 'Runoob', 1997, 2000]</pre>
      <div id="ai-info">AI 广告</div>
      <div class="previous-next-links">上一篇 下一篇</div>
      <div id="comments">用户笔记</div>
    </div>
    """
    sections = extract_source_sections_from_html(
        source_by_id("runoob-python3"),
        "https://www.runoob.com/python3/python3-list.html",
        "data/raw/runoob-python3/html/www.runoob.com/python3/python3-list.html",
        html,
        1,
    )
    combined = "\n".join(section["text"] for section in sections)
    assert "列表是 Python 中最基本的数据结构。" in combined
    assert "```python\nlist1 = ['Google', 'Runoob', 1997, 2000]\n```" in combined
    assert "AI 广告" not in combined
    assert "用户笔记" not in combined
