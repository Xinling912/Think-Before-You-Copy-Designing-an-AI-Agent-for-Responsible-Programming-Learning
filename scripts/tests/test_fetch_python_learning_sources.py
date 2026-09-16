from pathlib import Path

from scripts.corpus_sources import source_by_id
from scripts.fetch_python_learning_sources import discover_links, local_html_path


def test_runoob_discovers_python3_links():
    html = """
    <div class="design" id="leftcolumn">
      <a href="/python3/python3-tutorial.html">Python3 教程</a>
      <a href="/python3/python3-list.html">Python3 列表</a>
      <a href="/python/python-tutorial.html">Python2 教程</a>
    </div>
    """
    links = discover_links(source_by_id("runoob-python3"), "https://www.runoob.com/python3/python3-tutorial.html", html)
    assert links == [
        "https://www.runoob.com/python3/python3-list.html",
        "https://www.runoob.com/python3/python3-tutorial.html",
    ]


def test_py4e_keeps_html3_links_only():
    html = """
    <main id="main-content">
      <a href="01-intro.htm">Intro</a>
      <a href="/html3/02-variables.htm">Variables</a>
      <a href="/lessons">Lessons</a>
    </main>
    """
    links = discover_links(source_by_id("py4e-html3"), "https://www.py4e.com/html3/", html)
    assert links == [
        "https://www.py4e.com/html3/01-intro.htm",
        "https://www.py4e.com/html3/02-variables.htm",
    ]


def test_local_html_path_preserves_host_and_path():
    source = source_by_id("think-python-2e")
    path = local_html_path(source, "https://greenteapress.com/thinkpython2/html/chap02.html")
    assert path == Path("data/raw/think-python-2e/html/greenteapress.com/thinkpython2/html/chap02.html")
