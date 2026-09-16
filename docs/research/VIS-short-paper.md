# VIS Short Paper 参考文献候选清单（21 篇）

- 问卷相关 5 篇：全部引用。
- Agent 相关 16 篇：从原本 19 篇中排除了 RMM、Zep，以及 RAG + Code Interpreter 但当前系统尚未实现代码解释器的教育 Q&A 框架论文。

## 一、问卷与 Formative Study 相关文献（5 篇，必引）

### 1. Generative artificial intelligence dependency: Scale development, validation, and its motivational, behavioral, and psychological correlates（2025）

**主要内容：**
这篇论文开发并验证了生成式 AI 依赖量表，说明生成式 AI 依赖可以从多个心理和行为维度进行测量。

**和我们论文的关系：**
用于说明我们不是随便设计“AI 依赖”问题，而是基于已有量表和理论结构。

**引用建议：**
必引。用来支撑生成式 AI 依赖风险测量。

### 2. Generative AI dependency on programming among university students: a scale development and validation study（2026）

**主要内容：**
这篇论文专门面向大学生编程场景开发生成式 AI 依赖量表，关注学生在编程学习中对 AI 的行为、认知和情感依赖。

**和我们论文的关系：**
和我们的 Python 编程学习场景最直接相关。可以支撑问卷中关于“调试失败是否依赖 AI”“代码出错是否优先问 AI”等题项。

**引用建议：**
必引。它是问卷部分最核心的编程场景依赖文献。

### 3. An expectancy value theory (EVT) based instrument for measuring student perceptions of generative AI（2023）

**主要内容：**
这篇论文基于 Expectancy Value Theory 设计学生对生成式 AI 感知的测量工具，包括价值、成本、使用意向等维度。

**和我们论文的关系：**
用于支撑问卷中关于学生感知成本、风险、价值、接受度的问题。

**引用建议：**
必引。适合放在问卷设计依据中。

### 4. Exploring student perception and interaction using ChatGPT in programming education（2024）

**主要内容：**
这篇论文研究学生在编程教育中如何感知和使用 ChatGPT，包括学生认为 ChatGPT 对学习有哪些帮助，以及他们如何与 ChatGPT 互动。

**和我们论文的关系：**
用于支撑我们先做问卷调研，再根据学生真实使用习惯设计 Agent。

**引用建议：**
必引。适合放在 `Related Work` 或 `Formative Survey Study`。

### 5. Would ChatGPT-facilitated programming mode impact college students' programming behaviors, performances, and perceptions? An empirical study（2024）

**主要内容：**
这篇论文研究 ChatGPT 辅助编程模式对大学生编程行为、表现和感知的影响。

**和我们论文的关系：**
用于支撑问卷中关于 AI 对编程学习有用性、学习效率、学习表现、学习难度感知的问题。

**引用建议：**
必引。适合支撑问卷中的 perceived usefulness 相关题项。

## 二、ResponsibleEduAgent / AI Agent Design 相关文献（16 篇）

### 6. Retrieval-augmented generation for knowledge-intensive NLP tasks（2020）

**主要内容：**
RAG 的基础论文，提出将语言模型和外部检索文档结合，让生成结果有外部知识依据。

**和我们系统的关系：**
ResponsibleEduAgent 在回答学生问题前检索 Python 官方文档，并在界面中展示 RAG source。

**引用建议：**
强烈建议引用。用于支撑 RAG 基础机制。

### 7. DocPrompting: Generating code by retrieving the docs（2023）

**主要内容：**
这篇论文提出在代码生成或代码理解任务中，先检索相关文档，再把文档提供给模型生成结果。

**和我们系统的关系：**
我们的系统用 Python 官方文档作为 RAG 语料，逻辑上就是编程教育场景下的文档检索增强。

**引用建议：**
强烈建议引用。用于说明为什么选择 Python 官方文档作为知识来源。

### 8. Retrieval-augmented generation to improve math question-answering: Trade-offs between groundedness and human preference（2024）

**主要内容：**
这篇论文讨论教育问答中 RAG 的权衡：回答越扎根教材，不一定越符合学生偏好或越容易理解。

**和我们系统的关系：**
我们的系统不是直接复制 Python 官方文档，而是把检索到的证据转成适合初学者的提示和解释。

**引用建议：**
可以引用。适合说明“groundedness 和可理解性需要平衡”。

### 9. Automatic construction of educational knowledge graphs: A word embedding-based approach（2023）

**主要内容：**
这篇论文研究如何从教育材料中抽取概念并构建教育知识图谱。

**和我们系统的关系：**
我们的系统有 Python 学习知识图谱、KG path、KG candidate extraction 和 KG review 页面。

**引用建议：**
强烈建议引用。用于支撑 KG-guided RAG 和知识路径可视化。

### 10. A survey on the memory mechanism of large language model based agents（2025）

**主要内容：**
这篇综述总结 LLM Agent 记忆机制，包括 memory source、memory form、memory writing、memory management、memory reading 和 evaluation。

**和我们系统的关系：**
我们的系统有短期对话上下文、learner memory、memory events、memory evidence panel 等轻量记忆机制。

**引用建议：**
可以引用。用于给 Agent memory 一个总框架，但不要写成我们完整实现了综述里的所有机制。

### 11. MemoryBank: Enhancing large language models with long-term memory（2024）

**主要内容：**
MemoryBank 研究如何让大语言模型拥有长期记忆，包括记忆保存、召回、更新和类似遗忘曲线的衰减机制。

**和我们系统的关系：**
我们的 memory 里有 strength、use count、last used time、effective score 等字段，和轻量长期学习记忆相关。

**引用建议：**
可以引用。适合支撑长期 learner memory 的设计，但表述要谨慎。

### 12. Mem0: Building production-ready AI agents with scalable long-term memory（2025）

**主要内容：**
Mem0 研究生产级 AI Agent 的长期记忆机制，包括显著记忆抽取和 ADD / UPDATE / DELETE / NOOP 等操作。

**和我们系统的关系：**
我们的系统有 memory updates，并且 evidence / memory 页面展示 ADD、UPDATE、DELETE、NOOP 风格的记忆操作。

**引用建议：**
建议引用。比泛泛的 memory survey 更贴近我们当前实现。

### 13. LLM agents for education: Advances and applications（2025）

**主要内容：**
这篇论文综述 LLM Agent 在教育中的应用，包括反馈生成、学生支持、课程设计、知识追踪、工具使用和伦理风险。

**和我们系统的关系：**
ResponsibleEduAgent 的定位就是教育 Agent，而不是普通聊天机器人。

**引用建议：**
强烈建议引用。适合放在 Related Work 中定义研究位置。

### 14. Training LLM-based tutors to improve student learning outcomes in dialogues（2025）

**主要内容：**
这篇论文研究如何训练 LLM tutor，使其在对话中更有助于学生学习结果，而不是只生成流畅回答。

**和我们系统的关系：**
我们的系统通过 retrieve-first、hint ladder、confidence calibration、teach-back 等约束，让 AI 回复更像教学行为。

**引用建议：**
建议引用。用于支撑 pedagogical workflow。

### 15. Designing an LLM-based dialogue tutoring system for novice programming（2024）

**主要内容：**
这篇论文研究面向新手编程学习者的 LLM 对话导师系统设计。

**和我们系统的关系：**
我们的 pilot 场景也是 Python 初学者，重点处理 list index / IndexError 这类新手常见问题。

**引用建议：**
强烈建议引用。它和我们的应用场景非常接近。

### 16. GPTutor: A ChatGPT-powered programming tool for code explanation（2023）

**主要内容：**
GPTutor 是一个基于 ChatGPT 的编程代码解释工具，帮助学习者理解代码。

**和我们系统的关系：**
我们的系统也支持 Python 编程解释和错误理解，但我们额外加入 RAG、KG、教学约束和学习证据面板。

**引用建议：**
可以引用。适合放在 Related Work，用来对比普通代码解释工具和我们的 evidence-aware tutoring agent。

### 17. Exploring how multiple levels of GPT-generated programming hints support or disappoint novices（2024）

**主要内容：**
这篇 CHI 论文研究多层级 GPT 编程提示如何帮助或困扰新手。

**和我们系统的关系：**
我们的系统有 progressive hint ladder，不是一开始就给最终答案。

**引用建议：**
强烈建议引用。用于支撑分层提示设计。

### 18. How does LLM-powered coding assistance shape incidental learning? Exploring cognitive forcing strategies in programming education（2026）

**主要内容：**
这篇论文研究 LLM 编程辅助如何影响偶然学习，并提出 cognitive forcing strategies 来减少学生被动接受完整答案。

**和我们系统的关系：**
我们的 retrieve-first gate 和 student attempt required 正是为了防止学生直接拿答案。

**引用建议：**
强烈建议引用。用于支撑 anti-dependency 和 retrieve-first 设计。

### 19. Metacognition and Self-Regulated Learning: Guidance Report（2018）

**主要内容：**
这份报告总结元认知和自我调节学习，包括 plan、monitor、evaluate 等学习策略。

**和我们系统的关系：**
我们的系统记录 confidence，并通过 reflection / teach-back 让学生监控自己的理解。

**引用建议：**
可以引用。适合支撑 confidence calibration 和学习反思。

### 20. Fostering metacognitive skills in programming: Leveraging AI to reflect on code（2024）

**主要内容：**
这篇论文讨论如何利用 AI 帮助学生在编程中反思代码，从而培养元认知能力。

**和我们系统的关系：**
我们的 teach-back evaluator 要求学生用自己的话解释错误原因和修复思路，而不是只看 AI 答案。

**引用建议：**
建议引用。适合支撑 teach-back 和反思式编程学习。

### 21. Generative artificial intelligence-supported programming education: Effects on learning performance, self-efficacy and processes（2025）

**主要内容：**
这篇论文研究生成式 AI 支持的编程教育对学习表现、自我效能和学习过程的影响，也涉及过度依赖和认知外包风险。

**和我们系统的关系：**
我们的系统目标之一就是减少学生直接依赖 AI 答案，鼓励学生先尝试、解释和反思。

**引用建议：**
强烈建议引用。适合放在 Introduction 或 Related Work 中说明为什么需要 responsible AI tutoring。
