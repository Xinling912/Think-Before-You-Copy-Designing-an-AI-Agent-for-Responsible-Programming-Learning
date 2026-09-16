# ResponsibleEduAgent 论文依据与引用方式

本项目的研究依据不是泛泛地说“用了 RAG 和知识图谱”。四篇论文分别支撑系统中的四个关键判断：检索增强生成、编程文档检索、教育知识图谱构建、教育问答中的 RAG 与代码执行结合。

## 1. RAG 基础：Lewis et al., 2020

**论文**：Patrick Lewis et al. *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*. NeurIPS 2020 / arXiv. DOI: `10.48550/arXiv.2005.11401`  
**本地文件**：`data/raw/papers/lewis-2020-retrieval-augmented-generation.pdf`  
**公网链接**：[arXiv](https://arxiv.org/abs/2005.11401)

这篇论文支撑项目中的 RAG 基础设计：Agent 在回答前检索外部知识，而不是完全依赖模型参数中的记忆。对我们的项目来说，关键价值有三点。

第一，它证明“检索器 + 生成器”的结构适合知识密集型任务。Python 学习问答属于知识密集型任务，因为回答必须依赖明确的语法规则、官方定义、异常行为和示例代码。

第二，它支持把知识更新和模型本体解耦。Python 官方文档、课程内容、题目解释发生变化时，我们优先更新本地文档语料和索引，而不是改模型。

第三，它为 evidence panel 提供理论基础。系统展示 RAG source、chunk、source URL，不是装饰性功能，而是让学习反馈有可追溯证据。

**论文写法**：

> 本研究采用检索增强生成作为学习反馈生成的基础结构，使系统在生成解释前检索 Python 官方文档和课程材料，从而降低仅依赖模型参数记忆导致的知识不透明和来源不可追溯问题。

## 2. 编程文档检索：Zhou et al., 2022

**论文**：Shuyan Zhou, Uri Alon, Frank F. Xu, Zhiruo Wang, Zhengbao Jiang, Graham Neubig. *DocPrompting: Generating Code by Retrieving the Docs*. ICLR 2023 / arXiv. DOI: `10.48550/arXiv.2207.05987`  
**本地文件**：`data/raw/papers/zhou-2022-docprompting.pdf`  
**公网链接**：[arXiv](https://arxiv.org/abs/2207.05987)

这篇论文最贴近我们的编程学习场景。它的核心思想是：生成代码或回答编程问题时，先检索相关文档，再把文档内容放进 prompt。ResponsibleEduAgent 的 Python docs RAG 正是这个方向的教育版本。

它支撑三个工程选择。

第一，RAG 语料优先选择权威官方文档。对 `list.index`、`list.pop`、`IndexError` 这样的知识点，官方 Python docs 比普通博客、论坛回答和模型自带知识更适合做基础来源。

第二，检索单位必须保留 API/概念解释和示例代码的上下文。项目中的 chunk 不按固定长度盲切，而按 Tutorial 章节、标题、段落和代码块组织。

第三，文档检索结果需要在前端显示。学生和老师都能看到“AI 的解释来自哪里”，这能直接回应老师强调的学习目的和避免过度依赖。

**论文写法**：

> 由于本研究面向 Python 编程学习，系统采用文档检索增强的方式，将 Python 官方教程与 Glossary 作为主要知识来源。该选择与 DocPrompting 中“通过检索文档增强代码生成”的思路一致，但本研究将其扩展到学习提示、错误诊断和 teach-back 评价场景。

## 3. 教育知识图谱构建：Ain et al., 2023

**论文**：Qurat Ul Ain, Mohamed Amine Chatti, Komlan Gluck Charles Bakar, Shoeb Joarder, Rawaa Alatrash. *Automatic Construction of Educational Knowledge Graphs: A Word Embedding-based Approach*. Information 2023, 14(10), 526. DOI: `10.3390/info14100526`  
**本地文件**：`data/raw/papers/ain-2023-automatic-construction-educational-knowledge-graphs.pdf`  
**公网链接**：[MDPI](https://www.mdpi.com/2078-2489/14/10/526)，[作者机构页](https://www.uni-due.de/soco/research/projects/coursemapper.php)

这篇论文支撑项目中的 KG 层。它说明教育知识图谱可以从课程资源中抽取概念和关系，而不是完全靠人工从零画图。我们的路线不是直接让模型通篇生成最终 KG，而是采用“自动候选 + 人工审核”的结构。

它支撑三个设计。

第一，Python 官方 Tutorial 和 Glossary 可以作为 KG 候选抽取来源。章节标题提供课程结构，Glossary 提供术语定义，代码示例提供概念使用场景。

第二，KG 不是替代 RAG，而是引导 RAG。KG 决定学生当前问题应经过哪些概念路径，例如 `list -> index -> zero_based_index -> IndexError`；RAG 提供对应章节和术语的证据。

第三，教育 KG 必须服务学习路径，而不是只做漂亮图。MVP 的 KG path 必须能解释“为什么先问学生理解 index，再给提示，再要求 teach-back”。

**论文写法**：

> 本研究基于教育知识图谱思想组织 Python 概念、错误类型与学习路径。知识图谱由官方教程章节、Glossary 术语和人工审核的概念关系共同构成，用于引导检索、提示顺序和学习证据记录。

## 4. 教育 Q&A + RAG + Code：Lu and Li, 2025

**论文**：Jin Lu, Ji Li. *A novel framework for educational Q&A: Leveraging RAG and Code Interpreters for knowledge retrieval and logical computation*. PLOS ONE 20(12): e0337361. DOI: `10.1371/journal.pone.0337361`  
**本地文件**：`data/raw/papers/lu-2025-educational-qa-rag-code-interpreters.pdf`  
**公网链接**：[PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0337361)，[PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12668533/)

这篇论文支撑我们的教育场景落点。它不是只讨论通用问答，而是把 RAG 和代码解释/逻辑计算放进教育 Q&A 框架里。对 Python 编程学习系统来说，这直接支持“检索文档 + 代码行为验证 + 学习证据”的组合。

它支撑三个功能。

第一，编程学习回答不能只生成文本解释，还要能验证代码行为。MVP 的 `IndexError` 场景后续应加入安全的 Python snippet 执行或静态检查，用来验证学生代码是否真的越界。

第二，系统必须记录错误诊断、提示层级、学生信心和 teach-back。教育 Q&A 的价值不只是答对，而是证明学生获得了可观察的学习进展。

第三，失败模式需要前端可见。检索不到、代码执行失败、证据不足、学生直接要答案，这些都应该进入 evidence panel 和 harness。

**论文写法**：

> 本研究将教育问答中的 RAG 结构与编程任务的可执行性结合，强调系统不仅生成回答，还记录检索来源、代码行为、学生信心变化和复述表现，以评估 AI 是否真正促进学习。

## 5. 组合成我们的研究主线

四篇论文可以组合成一个稳定的论文叙事：

1. Lewis et al. 证明 RAG 是可行的知识增强生成结构。
2. Zhou et al. 证明编程任务特别适合检索官方文档来增强生成。
3. Ain et al. 证明教育资源可以构建知识图谱，KG 能表达概念关系和学习路径。
4. Lu and Li 证明教育 Q&A 可以结合 RAG 与代码执行，并需要处理检索与执行失败。

ResponsibleEduAgent 的创新点落在教育约束上：系统不追求直接给答案，而是通过 retrieve-first、confidence calibration、KG path、RAG source、hint ladder、teach-back 和 evidence panel，把生成式 AI 转化为可观察、可评估、可控制的学习支持工具。

## 6. BibTeX 草稿

```bibtex
@inproceedings{lewis2020rag,
  title={Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks},
  author={Lewis, Patrick and Perez, Ethan and Piktus, Aleksandra and Petroni, Fabio and Karpukhin, Vladimir and Goyal, Naman and Kuttler, Heinrich and Lewis, Mike and Yih, Wen-tau and Rocktaschel, Tim and Riedel, Sebastian and Kiela, Douwe},
  booktitle={Advances in Neural Information Processing Systems},
  year={2020}
}

@inproceedings{zhou2022docprompting,
  title={DocPrompting: Generating Code by Retrieving the Docs},
  author={Zhou, Shuyan and Alon, Uri and Xu, Frank F. and Wang, Zhiruo and Jiang, Zhengbao and Neubig, Graham},
  booktitle={International Conference on Learning Representations},
  year={2023}
}

@article{ain2023educationalkg,
  title={Automatic Construction of Educational Knowledge Graphs: A Word Embedding-based Approach},
  author={Ain, Qurat Ul and Chatti, Mohamed Amine and Bakar, Komlan Gluck Charles and Joarder, Shoeb and Alatrash, Rawaa},
  journal={Information},
  volume={14},
  number={10},
  pages={526},
  year={2023},
  doi={10.3390/info14100526}
}

@article{lu2025educationalqa,
  title={A novel framework for educational Q&A: Leveraging RAG and Code Interpreters for knowledge retrieval and logical computation},
  author={Lu, Jin and Li, Ji},
  journal={PLOS ONE},
  volume={20},
  number={12},
  pages={e0337361},
  year={2025},
  doi={10.1371/journal.pone.0337361}
}
```
