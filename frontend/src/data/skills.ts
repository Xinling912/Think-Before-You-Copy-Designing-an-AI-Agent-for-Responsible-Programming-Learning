export type SkillRow = {
  order: number;
  domain: string;
  skill: string;
  id: string;
  status: string;
  descriptionZh: string;
  mvp: boolean;
};

export const skillRows: SkillRow[] = [
  {
    "order": 1,
    "domain": "student-learning",
    "skill": "retrieve-first-gate",
    "id": "student-learning/retrieve-first-gate",
    "status": "MVP 启用",
    "descriptionZh": "要求学生先自由回忆或尝试解释，再获得 AI 帮助，防止一上来被动接受答案。",
    "mvp": true
  },
  {
    "order": 2,
    "domain": "student-learning",
    "skill": "progressive-hint-ladder",
    "id": "student-learning/progressive-hint-ladder",
    "status": "MVP 启用",
    "descriptionZh": "按层级逐步给提示，从概念提醒到平行示例，控制 AI 不直接给最终答案。",
    "mvp": true
  },
  {
    "order": 3,
    "domain": "student-learning",
    "skill": "stuck-and-error-diagnosis-coach",
    "id": "student-learning/stuck-and-error-diagnosis-coach",
    "status": "MVP 启用",
    "descriptionZh": "学生卡住或报错时，先诊断卡点、错误位置和错误类型，再获得针对性帮助。",
    "mvp": true
  },
  {
    "order": 4,
    "domain": "student-learning",
    "skill": "confidence-calibration-check",
    "id": "student-learning/confidence-calibration-check",
    "status": "MVP 启用",
    "descriptionZh": "记录学生答前和答后信心，观察是否过度自信、低估自己或校准变好。",
    "mvp": true
  },
  {
    "order": 5,
    "domain": "student-learning",
    "skill": "teach-back-evaluator",
    "id": "student-learning/teach-back-evaluator",
    "status": "MVP 启用",
    "descriptionZh": "要求学生用自己的话复述概念或修正逻辑，用复述证明真正理解。",
    "mvp": true
  },
  {
    "order": 1,
    "domain": "ai-learning-science",
    "skill": "adaptive-hint-sequence-designer",
    "id": "ai-learning-science/adaptive-hint-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "设计逐步揭示的提示序列，用于智能辅导、练习单或分层帮助。",
    "mvp": false
  },
  {
    "order": 2,
    "domain": "ai-learning-science",
    "skill": "ai-facilitated-collaborative-learning-designer",
    "id": "ai-learning-science/ai-facilitated-collaborative-learning-designer",
    "status": "候选待评审",
    "descriptionZh": "设计 AI 支持的小组协作学习活动，明确角色、互动和共同产出。",
    "mvp": false
  },
  {
    "order": 3,
    "domain": "ai-learning-science",
    "skill": "ai-feedback-design-principles",
    "id": "ai-learning-science/ai-feedback-design-principles",
    "status": "候选待评审",
    "descriptionZh": "设计高质量 AI 反馈，强调具体、可行动、面向学习过程而非简单评价。",
    "mvp": false
  },
  {
    "order": 4,
    "domain": "ai-learning-science",
    "skill": "cognitive-tutoring-architecture-designer",
    "id": "ai-learning-science/cognitive-tutoring-architecture-designer",
    "status": "候选待评审",
    "descriptionZh": "设计认知导师式系统架构，将知识点、错误模型、提示和掌握度连接起来。",
    "mvp": false
  },
  {
    "order": 5,
    "domain": "ai-learning-science",
    "skill": "digital-worked-example-sequence",
    "id": "ai-learning-science/digital-worked-example-sequence",
    "status": "候选待评审",
    "descriptionZh": "设计数字化 worked example 序列，让学生先看示例再逐步独立解决问题。",
    "mvp": false
  },
  {
    "order": 6,
    "domain": "ai-learning-science",
    "skill": "erroneous-example-designer",
    "id": "ai-learning-science/erroneous-example-designer",
    "status": "候选待评审",
    "descriptionZh": "设计带错误的示例，引导学生识别、解释并修正典型误区。",
    "mvp": false
  },
  {
    "order": 7,
    "domain": "ai-learning-science",
    "skill": "formative-assessment-loop-designer",
    "id": "ai-learning-science/formative-assessment-loop-designer",
    "status": "候选待评审",
    "descriptionZh": "设计形成性评价闭环，让诊断、反馈、再练习和调整教学形成循环。",
    "mvp": false
  },
  {
    "order": 8,
    "domain": "ai-learning-science",
    "skill": "individual-spacing-algorithm-explainer",
    "id": "ai-learning-science/individual-spacing-algorithm-explainer",
    "status": "候选待评审",
    "descriptionZh": "解释或设计个体化间隔复习算法，用于安排复习时间和知识回访。",
    "mvp": false
  },
  {
    "order": 9,
    "domain": "ai-learning-science",
    "skill": "intelligent-tutoring-dialogue-designer",
    "id": "ai-learning-science/intelligent-tutoring-dialogue-designer",
    "status": "候选待评审",
    "descriptionZh": "设计智能导师对话流程，让 AI 像导师一样追问、提示和反馈。",
    "mvp": false
  },
  {
    "order": 10,
    "domain": "ai-learning-science",
    "skill": "learning-analytics-interpretation-guide",
    "id": "ai-learning-science/learning-analytics-interpretation-guide",
    "status": "候选待评审",
    "descriptionZh": "解释学习分析数据，帮助判断学生表现、风险、进步和下一步支持。",
    "mvp": false
  },
  {
    "order": 11,
    "domain": "ai-learning-science",
    "skill": "metacognitive-monitoring-ai-contexts",
    "id": "ai-learning-science/metacognitive-monitoring-ai-contexts",
    "status": "候选待评审",
    "descriptionZh": "设计元认知监控活动，让学生判断自己是否真的理解 AI 给出的内容。",
    "mvp": false
  },
  {
    "order": 12,
    "domain": "ai-learning-science",
    "skill": "productive-failure-desirable-difficulty-designer",
    "id": "ai-learning-science/productive-failure-desirable-difficulty-designer",
    "status": "候选待评审",
    "descriptionZh": "设计有益困难和 productive failure 活动，让学生先尝试再获得讲解。",
    "mvp": false
  },
  {
    "order": 13,
    "domain": "ai-learning-science",
    "skill": "self-explanation-prompt-designer",
    "id": "ai-learning-science/self-explanation-prompt-designer",
    "status": "候选待评审",
    "descriptionZh": "设计自我解释提示，促使学生说出推理过程和概念连接。",
    "mvp": false
  },
  {
    "order": 14,
    "domain": "ai-learning-science",
    "skill": "worked-example-to-problem-solving-transition-designer",
    "id": "ai-learning-science/worked-example-to-problem-solving-transition-designer",
    "status": "候选待评审",
    "descriptionZh": "设计从看例题到独立解题的过渡路径，逐步减少支架。",
    "mvp": false
  },
  {
    "order": 15,
    "domain": "ai-literacy",
    "skill": "ai-expertise-interrogation-designer",
    "id": "ai-literacy/ai-expertise-interrogation-designer",
    "status": "候选待评审",
    "descriptionZh": "引导学生审视 AI 在某领域是否真的可靠，识别 AI 专长边界。",
    "mvp": false
  },
  {
    "order": 16,
    "domain": "ai-literacy",
    "skill": "ai-hallucination-fact-check-protocol",
    "id": "ai-literacy/ai-hallucination-fact-check-protocol",
    "status": "候选待评审",
    "descriptionZh": "设计 AI 幻觉核查流程，让学生验证 AI 输出中的事实和依据。",
    "mvp": false
  },
  {
    "order": 17,
    "domain": "ai-literacy",
    "skill": "ai-learning-boundary-mapper",
    "id": "ai-literacy/ai-learning-boundary-mapper",
    "status": "候选待评审",
    "descriptionZh": "帮助学生划清 AI 可以辅助和不能替代学习的边界。",
    "mvp": false
  },
  {
    "order": 18,
    "domain": "ai-literacy",
    "skill": "ai-output-critical-audit-designer",
    "id": "ai-literacy/ai-output-critical-audit-designer",
    "status": "候选待评审",
    "descriptionZh": "设计 AI 输出批判性审查任务，检查准确性、偏见、证据和遗漏。",
    "mvp": false
  },
  {
    "order": 19,
    "domain": "ai-literacy",
    "skill": "ai-socratic-dialogue-designer",
    "id": "ai-literacy/ai-socratic-dialogue-designer",
    "status": "候选待评审",
    "descriptionZh": "设计苏格拉底式 AI 对话，用追问推动学生思考而不是直接告知。",
    "mvp": false
  },
  {
    "order": 20,
    "domain": "ai-literacy",
    "skill": "disciplinary-ai-literacy-sequence-designer",
    "id": "ai-literacy/disciplinary-ai-literacy-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "按学科设计 AI 素养学习序列，让学生理解本学科如何负责任使用 AI。",
    "mvp": false
  },
  {
    "order": 21,
    "domain": "ai-literacy",
    "skill": "prompt-literacy-sequence-designer",
    "id": "ai-literacy/prompt-literacy-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "设计提示词素养训练序列，让学生学会提出清晰、可验证的问题。",
    "mvp": false
  },
  {
    "order": 22,
    "domain": "curriculum-alignment",
    "skill": "coverage-audit",
    "id": "curriculum-alignment/coverage-audit",
    "status": "候选待评审",
    "descriptionZh": "审查课程覆盖范围，发现标准、知识点或能力要求中的缺口和重复。",
    "mvp": false
  },
  {
    "order": 23,
    "domain": "curriculum-alignment",
    "skill": "curriculum-crosswalk",
    "id": "curriculum-alignment/curriculum-crosswalk",
    "status": "候选待评审",
    "descriptionZh": "对齐不同课程标准、教材或评价框架，建立映射关系。",
    "mvp": false
  },
  {
    "order": 24,
    "domain": "curriculum-alignment",
    "skill": "developmental-band-translator",
    "id": "curriculum-alignment/developmental-band-translator",
    "status": "候选待评审",
    "descriptionZh": "把能力要求转换到不同年龄段或发展阶段可理解的学习目标。",
    "mvp": false
  },
  {
    "order": 25,
    "domain": "curriculum-alignment",
    "skill": "kud-chart-author",
    "id": "curriculum-alignment/kud-chart-author",
    "status": "候选待评审",
    "descriptionZh": "生成 KUD 表，区分学生需要知道、理解和能够做到的内容。",
    "mvp": false
  },
  {
    "order": 26,
    "domain": "curriculum-assessment",
    "skill": "assessment-validity-checker",
    "id": "curriculum-assessment/assessment-validity-checker",
    "status": "候选待评审",
    "descriptionZh": "检查评价任务是否真正测量目标能力，避免测偏或要求不一致。",
    "mvp": false
  },
  {
    "order": 27,
    "domain": "curriculum-assessment",
    "skill": "backwards-design-unit-planner",
    "id": "curriculum-assessment/backwards-design-unit-planner",
    "status": "候选待评审",
    "descriptionZh": "从学习结果倒推评价证据和学习活动，设计完整单元。",
    "mvp": false
  },
  {
    "order": 28,
    "domain": "curriculum-assessment",
    "skill": "competency-unpacker",
    "id": "curriculum-assessment/competency-unpacker",
    "status": "候选待评审",
    "descriptionZh": "拆解复杂能力，明确其中的知识、技能、策略和表现证据。",
    "mvp": false
  },
  {
    "order": 29,
    "domain": "curriculum-assessment",
    "skill": "criterion-referenced-rubric-generator",
    "id": "curriculum-assessment/criterion-referenced-rubric-generator",
    "status": "候选待评审",
    "descriptionZh": "生成基于标准的评价量规，用明确标准评价学生表现。",
    "mvp": false
  },
  {
    "order": 30,
    "domain": "curriculum-assessment",
    "skill": "critical-thinking-task-designer",
    "id": "curriculum-assessment/critical-thinking-task-designer",
    "status": "候选待评审",
    "descriptionZh": "设计批判性思维任务，要求分析、评价、论证和迁移。",
    "mvp": false
  },
  {
    "order": 31,
    "domain": "curriculum-assessment",
    "skill": "curriculum-knowledge-architecture-designer",
    "id": "curriculum-assessment/curriculum-knowledge-architecture-designer",
    "status": "候选待评审",
    "descriptionZh": "设计课程知识架构，组织概念、先修关系、主题和评价。",
    "mvp": false
  },
  {
    "order": 32,
    "domain": "curriculum-assessment",
    "skill": "differentiation-adapter",
    "id": "curriculum-assessment/differentiation-adapter",
    "status": "候选待评审",
    "descriptionZh": "根据学生差异调整任务难度、支架、材料和输出方式。",
    "mvp": false
  },
  {
    "order": 33,
    "domain": "curriculum-assessment",
    "skill": "formative-assessment-technique-selector",
    "id": "curriculum-assessment/formative-assessment-technique-selector",
    "status": "候选待评审",
    "descriptionZh": "根据目标选择合适的形成性评价技术，如出口票、诊断题或同伴反馈。",
    "mvp": false
  },
  {
    "order": 34,
    "domain": "curriculum-assessment",
    "skill": "gap-analysis-from-student-work",
    "id": "curriculum-assessment/gap-analysis-from-student-work",
    "status": "候选待评审",
    "descriptionZh": "从学生作品中分析知识或能力缺口，给出后续教学建议。",
    "mvp": false
  },
  {
    "order": 35,
    "domain": "curriculum-assessment",
    "skill": "kud-knowledge-type-mapper",
    "id": "curriculum-assessment/kud-knowledge-type-mapper",
    "status": "候选待评审",
    "descriptionZh": "把 KUD 目标映射到事实、概念、程序和元认知等知识类型。",
    "mvp": false
  },
  {
    "order": 36,
    "domain": "curriculum-assessment",
    "skill": "learning-progression-builder",
    "id": "curriculum-assessment/learning-progression-builder",
    "status": "候选待评审",
    "descriptionZh": "构建学习进阶路径，说明能力从初级到高级如何发展。",
    "mvp": false
  },
  {
    "order": 37,
    "domain": "curriculum-assessment",
    "skill": "project-brief-designer",
    "id": "curriculum-assessment/project-brief-designer",
    "status": "候选待评审",
    "descriptionZh": "设计项目式学习任务书，明确情境、产出、标准和约束。",
    "mvp": false
  },
  {
    "order": 38,
    "domain": "curriculum-assessment",
    "skill": "scope-and-sequence-designer",
    "id": "curriculum-assessment/scope-and-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "规划课程范围和顺序，安排每阶段学习内容和递进关系。",
    "mvp": false
  },
  {
    "order": 39,
    "domain": "eal-language-development",
    "skill": "academic-language-sentence-frame-generator",
    "id": "eal-language-development/academic-language-sentence-frame-generator",
    "status": "候选待评审",
    "descriptionZh": "为英语学习者生成学术表达句架，支持讨论、解释和写作。",
    "mvp": false
  },
  {
    "order": 40,
    "domain": "eal-language-development",
    "skill": "language-demand-analyser",
    "id": "eal-language-development/language-demand-analyser",
    "status": "候选待评审",
    "descriptionZh": "分析任务中的语言要求，识别词汇、句型、语篇和表达难点。",
    "mvp": false
  },
  {
    "order": 41,
    "domain": "eal-language-development",
    "skill": "scaffolded-task-modifier",
    "id": "eal-language-development/scaffolded-task-modifier",
    "status": "候选待评审",
    "descriptionZh": "修改学习任务，给语言学习者加入词汇、句架和过程支架。",
    "mvp": false
  },
  {
    "order": 42,
    "domain": "eal-language-development",
    "skill": "sheltered-instruction-lesson-modifier",
    "id": "eal-language-development/sheltered-instruction-lesson-modifier",
    "status": "候选待评审",
    "descriptionZh": "把普通课程改造成 sheltered instruction，兼顾内容学习和语言支持。",
    "mvp": false
  },
  {
    "order": 43,
    "domain": "eal-language-development",
    "skill": "vocabulary-tiering-tool",
    "id": "eal-language-development/vocabulary-tiering-tool",
    "status": "候选待评审",
    "descriptionZh": "按词汇层级整理词语，区分基础词、学术词和学科核心词。",
    "mvp": false
  },
  {
    "order": 44,
    "domain": "environmental-experiential-learning",
    "skill": "biophilic-learning-environment-designer",
    "id": "environmental-experiential-learning/biophilic-learning-environment-designer",
    "status": "候选待评审",
    "descriptionZh": "设计亲自然学习环境，把自然元素融入学习空间和活动。",
    "mvp": false
  },
  {
    "order": 45,
    "domain": "environmental-experiential-learning",
    "skill": "ecological-inquiry-anchor-designer",
    "id": "environmental-experiential-learning/ecological-inquiry-anchor-designer",
    "status": "候选待评审",
    "descriptionZh": "设计生态探究锚点，用真实环境问题引发跨学科学习。",
    "mvp": false
  },
  {
    "order": 46,
    "domain": "environmental-experiential-learning",
    "skill": "experiential-learning-cycle-designer",
    "id": "environmental-experiential-learning/experiential-learning-cycle-designer",
    "status": "候选待评审",
    "descriptionZh": "设计体验学习循环，包含体验、反思、概念化和应用。",
    "mvp": false
  },
  {
    "order": 47,
    "domain": "environmental-experiential-learning",
    "skill": "interdisciplinary-real-world-connection-mapper",
    "id": "environmental-experiential-learning/interdisciplinary-real-world-connection-mapper",
    "status": "候选待评审",
    "descriptionZh": "把课程内容连接到真实世界问题和跨学科情境。",
    "mvp": false
  },
  {
    "order": 48,
    "domain": "environmental-experiential-learning",
    "skill": "outdoor-learning-sequence-designer",
    "id": "environmental-experiential-learning/outdoor-learning-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "设计户外学习序列，安排观察、探究、记录和反思。",
    "mvp": false
  },
  {
    "order": 49,
    "domain": "environmental-experiential-learning",
    "skill": "service-learning-project-designer",
    "id": "environmental-experiential-learning/service-learning-project-designer",
    "status": "候选待评审",
    "descriptionZh": "设计服务学习项目，把社区服务和课程目标结合起来。",
    "mvp": false
  },
  {
    "order": 50,
    "domain": "explicit-instruction",
    "skill": "checking-for-understanding-protocol-designer",
    "id": "explicit-instruction/checking-for-understanding-protocol-designer",
    "status": "候选待评审",
    "descriptionZh": "设计理解检查流程，及时发现学生是否掌握关键内容。",
    "mvp": false
  },
  {
    "order": 51,
    "domain": "explicit-instruction",
    "skill": "explicit-instruction-sequence-builder",
    "id": "explicit-instruction/explicit-instruction-sequence-builder",
    "status": "候选待评审",
    "descriptionZh": "构建显性教学序列，包括示范、引导练习、独立练习和反馈。",
    "mvp": false
  },
  {
    "order": 52,
    "domain": "explicit-instruction",
    "skill": "lesson-opening-designer",
    "id": "explicit-instruction/lesson-opening-designer",
    "status": "候选待评审",
    "descriptionZh": "设计课堂开场，激活先知、明确目标并引入任务。",
    "mvp": false
  },
  {
    "order": 53,
    "domain": "explicit-instruction",
    "skill": "practice-problem-sequence-designer",
    "id": "explicit-instruction/practice-problem-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "设计练习题序列，从低负荷到高迁移逐步推进。",
    "mvp": false
  },
  {
    "order": 54,
    "domain": "explicit-instruction",
    "skill": "think-aloud-script-generator",
    "id": "explicit-instruction/think-aloud-script-generator",
    "status": "候选待评审",
    "descriptionZh": "生成教师 think-aloud 脚本，示范专家如何思考和解题。",
    "mvp": false
  },
  {
    "order": 55,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "cpa-sequence-designer",
    "id": "global-cross-cultural-pedagogies/cpa-sequence-designer",
    "status": "候选待评审",
    "descriptionZh": "设计具体-表征-抽象序列，帮助学生从操作走向抽象理解。",
    "mvp": false
  },
  {
    "order": 56,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "cross-cultural-task-validity-checker",
    "id": "global-cross-cultural-pedagogies/cross-cultural-task-validity-checker",
    "status": "候选待评审",
    "descriptionZh": "检查任务在跨文化语境下是否公平、可理解、有效。",
    "mvp": false
  },
  {
    "order": 57,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "culturally-responsive-teaching-designer",
    "id": "global-cross-cultural-pedagogies/culturally-responsive-teaching-designer",
    "status": "候选待评审",
    "descriptionZh": "设计文化回应式教学，让学生经验和文化背景进入学习。",
    "mvp": false
  },
  {
    "order": 58,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "emergent-project-design-scaffold",
    "id": "global-cross-cultural-pedagogies/emergent-project-design-scaffold",
    "status": "候选待评审",
    "descriptionZh": "为生成式项目学习提供支架，让项目从学生兴趣和情境中生长。",
    "mvp": false
  },
  {
    "order": 59,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "phenomenon-based-unit-anchor",
    "id": "global-cross-cultural-pedagogies/phenomenon-based-unit-anchor",
    "status": "候选待评审",
    "descriptionZh": "以真实现象作为单元锚点，组织跨学科学习。",
    "mvp": false
  },
  {
    "order": 60,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "place-based-inquiry-anchor",
    "id": "global-cross-cultural-pedagogies/place-based-inquiry-anchor",
    "status": "候选待评审",
    "descriptionZh": "以地方情境作为探究锚点，把学习连接到学生所在社区。",
    "mvp": false
  },
  {
    "order": 61,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "reggio-documentation-protocol",
    "id": "global-cross-cultural-pedagogies/reggio-documentation-protocol",
    "status": "候选待评审",
    "descriptionZh": "设计 Reggio 式学习记录流程，捕捉学生思考和作品演变。",
    "mvp": false
  },
  {
    "order": 62,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "ubuntu-collective-knowledge-task-designer",
    "id": "global-cross-cultural-pedagogies/ubuntu-collective-knowledge-task-designer",
    "status": "候选待评审",
    "descriptionZh": "设计强调共同体和集体知识建构的学习任务。",
    "mvp": false
  },
  {
    "order": 63,
    "domain": "global-cross-cultural-pedagogies",
    "skill": "variation-theory-task-designer",
    "id": "global-cross-cultural-pedagogies/variation-theory-task-designer",
    "status": "候选待评审",
    "descriptionZh": "设计变式理论任务，通过关键特征变化促进概念辨析。",
    "mvp": false
  },
  {
    "order": 64,
    "domain": "historical-thinking",
    "skill": "central-historical-question-evaluator",
    "id": "historical-thinking/central-historical-question-evaluator",
    "status": "候选待评审",
    "descriptionZh": "评估历史课的核心问题是否具有探究价值和解释空间。",
    "mvp": false
  },
  {
    "order": 65,
    "domain": "historical-thinking",
    "skill": "close-reading-skill-builder",
    "id": "historical-thinking/close-reading-skill-builder",
    "status": "候选待评审",
    "descriptionZh": "设计历史文本细读训练，关注措辞、证据和隐含立场。",
    "mvp": false
  },
  {
    "order": 66,
    "domain": "historical-thinking",
    "skill": "contextualisation-skill-builder",
    "id": "historical-thinking/contextualisation-skill-builder",
    "status": "候选待评审",
    "descriptionZh": "训练历史情境化能力，让学生把资料放回时代背景理解。",
    "mvp": false
  },
  {
    "order": 67,
    "domain": "historical-thinking",
    "skill": "corroboration-skill-builder",
    "id": "historical-thinking/corroboration-skill-builder",
    "status": "候选待评审",
    "descriptionZh": "训练互证能力，让学生比较多个史料来源并判断一致性。",
    "mvp": false
  },
  {
    "order": 68,
    "domain": "historical-thinking",
    "skill": "document-based-lesson-designer",
    "id": "historical-thinking/document-based-lesson-designer",
    "status": "候选待评审",
    "descriptionZh": "设计基于文献资料的历史课，围绕史料分析展开。",
    "mvp": false
  },
  {
    "order": 69,
    "domain": "historical-thinking",
    "skill": "historical-document-set-curator",
    "id": "historical-thinking/historical-document-set-curator",
    "status": "候选待评审",
    "descriptionZh": "挑选和组织历史资料集，形成可用于课堂探究的证据包。",
    "mvp": false
  },
  {
    "order": 70,
    "domain": "historical-thinking",
    "skill": "historical-source-adapter",
    "id": "historical-thinking/historical-source-adapter",
    "status": "候选待评审",
    "descriptionZh": "改编历史资料，使其适合不同学生水平，同时保留史料核心。",
    "mvp": false
  },
  {
    "order": 71,
    "domain": "historical-thinking",
    "skill": "historical-thinking-assessment-designer",
    "id": "historical-thinking/historical-thinking-assessment-designer",
    "status": "候选待评审",
    "descriptionZh": "设计历史思维评价任务，测量 sourcing、contextualisation 等能力。",
    "mvp": false
  },
  {
    "order": 72,
    "domain": "historical-thinking",
    "skill": "historical-thinking-strategy-modelling-guide",
    "id": "historical-thinking/historical-thinking-strategy-modelling-guide",
    "status": "候选待评审",
    "descriptionZh": "设计历史思维策略示范，展示专家如何分析史料。",
    "mvp": false
  },
  {
    "order": 73,
    "domain": "historical-thinking",
    "skill": "sourcing-skill-builder",
    "id": "historical-thinking/sourcing-skill-builder",
    "status": "候选待评审",
    "descriptionZh": "训练史料来源分析能力，关注作者、目的、受众和可信度。",
    "mvp": false
  },
  {
    "order": 74,
    "domain": "inclusive-design",
    "skill": "udl-barrier-anticipator",
    "id": "inclusive-design/udl-barrier-anticipator",
    "status": "候选待评审",
    "descriptionZh": "预判学习任务中的障碍，并用 UDL 原则提前降低门槛。",
    "mvp": false
  },
  {
    "order": 75,
    "domain": "inclusive-design",
    "skill": "udl-lesson-auditor",
    "id": "inclusive-design/udl-lesson-auditor",
    "status": "候选待评审",
    "descriptionZh": "审查课程是否符合 UDL，检查表达、参与和行动方式是否多样。",
    "mvp": false
  },
  {
    "order": 76,
    "domain": "inclusive-design",
    "skill": "udl-options-designer",
    "id": "inclusive-design/udl-options-designer",
    "status": "候选待评审",
    "descriptionZh": "设计多种学习路径、表达方式和参与选择，提高可及性。",
    "mvp": false
  },
  {
    "order": 77,
    "domain": "literacy-critical-thinking",
    "skill": "argument-structure-scaffold-generator",
    "id": "literacy-critical-thinking/argument-structure-scaffold-generator",
    "status": "候选待评审",
    "descriptionZh": "生成论证结构支架，帮助学生组织主张、证据和推理。",
    "mvp": false
  },
  {
    "order": 78,
    "domain": "literacy-critical-thinking",
    "skill": "critical-thinking-task-designer",
    "id": "literacy-critical-thinking/critical-thinking-task-designer",
    "status": "候选待评审",
    "descriptionZh": "设计批判性思维任务，要求比较、评价、推断和论证。",
    "mvp": false
  },
  {
    "order": 79,
    "domain": "literacy-critical-thinking",
    "skill": "disciplinary-writing-scaffold",
    "id": "literacy-critical-thinking/disciplinary-writing-scaffold",
    "status": "候选待评审",
    "descriptionZh": "生成学科写作支架，帮助学生按学科规范表达观点。",
    "mvp": false
  },
  {
    "order": 80,
    "domain": "literacy-critical-thinking",
    "skill": "media-literacy-deconstruction-protocol",
    "id": "literacy-critical-thinking/media-literacy-deconstruction-protocol",
    "status": "候选待评审",
    "descriptionZh": "设计媒体素养拆解流程，分析信息来源、目的、技巧和偏见。",
    "mvp": false
  },
  {
    "order": 81,
    "domain": "literacy-critical-thinking",
    "skill": "reading-comprehension-strategy-selector",
    "id": "literacy-critical-thinking/reading-comprehension-strategy-selector",
    "status": "候选待评审",
    "descriptionZh": "根据文本和学习目标选择阅读理解策略。",
    "mvp": false
  },
  {
    "order": 82,
    "domain": "literacy-critical-thinking",
    "skill": "source-credibility-evaluation-protocol",
    "id": "literacy-critical-thinking/source-credibility-evaluation-protocol",
    "status": "候选待评审",
    "descriptionZh": "设计来源可信度评价流程，判断信息是否可靠。",
    "mvp": false
  },
  {
    "order": 83,
    "domain": "literacy-critical-thinking",
    "skill": "text-complexity-analyser",
    "id": "literacy-critical-thinking/text-complexity-analyser",
    "status": "候选待评审",
    "descriptionZh": "分析文本复杂度，包括词汇、句法、结构、背景知识和抽象程度。",
    "mvp": false
  },
  {
    "order": 84,
    "domain": "memory-learning-science",
    "skill": "cognitive-load-analyser",
    "id": "memory-learning-science/cognitive-load-analyser",
    "status": "候选待评审",
    "descriptionZh": "分析任务的认知负荷，区分内在、外在和生成性负荷。",
    "mvp": false
  },
  {
    "order": 85,
    "domain": "memory-learning-science",
    "skill": "dual-coding-designer",
    "id": "memory-learning-science/dual-coding-designer",
    "status": "候选待评审",
    "descriptionZh": "设计双编码学习材料，把文字和图像结构配合起来。",
    "mvp": false
  },
  {
    "order": 86,
    "domain": "memory-learning-science",
    "skill": "elaborative-interrogation-generator",
    "id": "memory-learning-science/elaborative-interrogation-generator",
    "status": "候选待评审",
    "descriptionZh": "生成精加工追问，促使学生解释“为什么”和“如何”。",
    "mvp": false
  },
  {
    "order": 87,
    "domain": "memory-learning-science",
    "skill": "feedback-quality-analyser",
    "id": "memory-learning-science/feedback-quality-analyser",
    "status": "候选待评审",
    "descriptionZh": "分析反馈质量，判断是否具体、及时、可行动、面向目标。",
    "mvp": false
  },
  {
    "order": 88,
    "domain": "memory-learning-science",
    "skill": "interleaving-unit-planner",
    "id": "memory-learning-science/interleaving-unit-planner",
    "status": "候选待评审",
    "descriptionZh": "设计交错练习单元，把不同但相关的题型或概念混合安排。",
    "mvp": false
  },
  {
    "order": 89,
    "domain": "memory-learning-science",
    "skill": "retrieval-practice-generator",
    "id": "memory-learning-science/retrieval-practice-generator",
    "status": "候选待评审",
    "descriptionZh": "生成检索练习，帮助学生主动回忆而不是只重读。",
    "mvp": false
  },
  {
    "order": 90,
    "domain": "memory-learning-science",
    "skill": "spaced-practice-scheduler",
    "id": "memory-learning-science/spaced-practice-scheduler",
    "status": "候选待评审",
    "descriptionZh": "安排间隔复习计划，让知识在合适时间被重新提取。",
    "mvp": false
  },
  {
    "order": 91,
    "domain": "memory-learning-science",
    "skill": "worked-example-fading-designer",
    "id": "memory-learning-science/worked-example-fading-designer",
    "status": "候选待评审",
    "descriptionZh": "设计 worked example fading，从完整示例逐步过渡到独立解题。",
    "mvp": false
  },
  {
    "order": 92,
    "domain": "montessori-alternative-approaches",
    "skill": "mixed-age-learning-task-designer",
    "id": "montessori-alternative-approaches/mixed-age-learning-task-designer",
    "status": "候选待评审",
    "descriptionZh": "设计混龄学习任务，让不同年龄或水平学生互相支持。",
    "mvp": false
  },
  {
    "order": 93,
    "domain": "montessori-alternative-approaches",
    "skill": "prepared-environment-designer",
    "id": "montessori-alternative-approaches/prepared-environment-designer",
    "status": "候选待评审",
    "descriptionZh": "设计准备好的学习环境，让材料、空间和任务支持自主探索。",
    "mvp": false
  },
  {
    "order": 94,
    "domain": "montessori-alternative-approaches",
    "skill": "three-part-lesson-designer",
    "id": "montessori-alternative-approaches/three-part-lesson-designer",
    "status": "候选待评审",
    "descriptionZh": "设计三阶段教学：命名、识别、回忆，支持概念建立。",
    "mvp": false
  },
  {
    "order": 95,
    "domain": "montessori-alternative-approaches",
    "skill": "uninterrupted-work-cycle-designer",
    "id": "montessori-alternative-approaches/uninterrupted-work-cycle-designer",
    "status": "候选待评审",
    "descriptionZh": "设计不被打断的工作周期，支持深度专注和自主学习。",
    "mvp": false
  },
  {
    "order": 96,
    "domain": "original-frameworks",
    "skill": "assessment-design-orchestrator",
    "id": "original-frameworks/assessment-design-orchestrator",
    "status": "候选待评审",
    "descriptionZh": "统筹评价设计，协调目标、证据、任务、标准和反馈。",
    "mvp": false
  },
  {
    "order": 97,
    "domain": "original-frameworks",
    "skill": "coherent-rubric-logic-builder",
    "id": "original-frameworks/coherent-rubric-logic-builder",
    "status": "候选待评审",
    "descriptionZh": "构建逻辑一致的评价量规，保证等级描述和标准匹配。",
    "mvp": false
  },
  {
    "order": 98,
    "domain": "original-frameworks",
    "skill": "compassionate-systems-awareness-orchestrator",
    "id": "original-frameworks/compassionate-systems-awareness-orchestrator",
    "status": "候选待评审",
    "descriptionZh": "设计有同理心的系统意识活动，理解复杂问题中的多方关系。",
    "mvp": false
  },
  {
    "order": 99,
    "domain": "original-frameworks",
    "skill": "developmental-band-system-designer",
    "id": "original-frameworks/developmental-band-system-designer",
    "status": "候选待评审",
    "descriptionZh": "设计发展阶段系统，将能力表现按阶段组织。",
    "mvp": false
  },
  {
    "order": 100,
    "domain": "original-frameworks",
    "skill": "developmental-progression-synthesis",
    "id": "original-frameworks/developmental-progression-synthesis",
    "status": "候选待评审",
    "descriptionZh": "综合发展进阶，形成从初学到熟练的能力路径。",
    "mvp": false
  },
  {
    "order": 101,
    "domain": "original-frameworks",
    "skill": "dilemma-navigation-for-education-design",
    "id": "original-frameworks/dilemma-navigation-for-education-design",
    "status": "候选待评审",
    "descriptionZh": "分析教育设计中的两难问题，平衡冲突价值和约束。",
    "mvp": false
  },
  {
    "order": 102,
    "domain": "original-frameworks",
    "skill": "dispositional-knowledge-assessment-designer",
    "id": "original-frameworks/dispositional-knowledge-assessment-designer",
    "status": "候选待评审",
    "descriptionZh": "设计对倾向性知识或习惯性能力的评价，如坚持、好奇、反思。",
    "mvp": false
  },
  {
    "order": 103,
    "domain": "original-frameworks",
    "skill": "inclusive-design-orchestrator",
    "id": "original-frameworks/inclusive-design-orchestrator",
    "status": "候选待评审",
    "descriptionZh": "统筹包容性设计，协调障碍识别、支架和多样化路径。",
    "mvp": false
  },
  {
    "order": 104,
    "domain": "original-frameworks",
    "skill": "learning-target-authoring-guide",
    "id": "original-frameworks/learning-target-authoring-guide",
    "status": "候选待评审",
    "descriptionZh": "编写清晰学习目标，区分知识、理解、技能和表现。",
    "mvp": false
  },
  {
    "order": 105,
    "domain": "original-frameworks",
    "skill": "multi-perspective-decision-wheel",
    "id": "original-frameworks/multi-perspective-decision-wheel",
    "status": "候选待评审",
    "descriptionZh": "用多视角决策轮分析教育方案，从不同利益相关者角度审视。",
    "mvp": false
  },
  {
    "order": 106,
    "domain": "original-frameworks",
    "skill": "place-based-curriculum-orchestrator",
    "id": "original-frameworks/place-based-curriculum-orchestrator",
    "status": "候选待评审",
    "descriptionZh": "统筹地方本位课程设计，把地方资源、问题和课程目标连接起来。",
    "mvp": false
  },
  {
    "order": 107,
    "domain": "original-frameworks",
    "skill": "regenerative-project-design-orchestrator",
    "id": "original-frameworks/regenerative-project-design-orchestrator",
    "status": "候选待评审",
    "descriptionZh": "设计再生型项目学习，强调生态、社区和长期影响。",
    "mvp": false
  },
  {
    "order": 108,
    "domain": "original-frameworks",
    "skill": "scoping-for-transformative-learning-inquiry",
    "id": "original-frameworks/scoping-for-transformative-learning-inquiry",
    "status": "候选待评审",
    "descriptionZh": "界定转化性学习探究范围，明确问题、系统边界和学习目标。",
    "mvp": false
  },
  {
    "order": 109,
    "domain": "original-frameworks",
    "skill": "seeds-regenerative-inquiry-cycle",
    "id": "original-frameworks/seeds-regenerative-inquiry-cycle",
    "status": "候选待评审",
    "descriptionZh": "设计 SEEDS 再生探究循环，推动观察、设计、行动和反思。",
    "mvp": false
  },
  {
    "order": 110,
    "domain": "original-frameworks",
    "skill": "self-determined-project-design-protocol",
    "id": "original-frameworks/self-determined-project-design-protocol",
    "status": "候选待评审",
    "descriptionZh": "设计自主项目学习协议，让学生拥有目标、路径和评价参与权。",
    "mvp": false
  },
  {
    "order": 111,
    "domain": "original-frameworks",
    "skill": "single-point-rubric-designer",
    "id": "original-frameworks/single-point-rubric-designer",
    "status": "候选待评审",
    "descriptionZh": "设计单点量规，用一个清晰标准描述成功表现并留出反馈空间。",
    "mvp": false
  },
  {
    "order": 112,
    "domain": "original-frameworks",
    "skill": "three-horizons-learning-transition-mapper",
    "id": "original-frameworks/three-horizons-learning-transition-mapper",
    "status": "候选待评审",
    "descriptionZh": "用三视野框架分析教育转型，从当前系统走向未来愿景。",
    "mvp": false
  },
  {
    "order": 113,
    "domain": "professional-learning",
    "skill": "competency-framework-translator",
    "id": "professional-learning/competency-framework-translator",
    "status": "候选待评审",
    "descriptionZh": "把能力框架转换成教师专业学习目标和实践任务。",
    "mvp": false
  },
  {
    "order": 114,
    "domain": "professional-learning",
    "skill": "instructional-coaching-conversation-guide",
    "id": "professional-learning/instructional-coaching-conversation-guide",
    "status": "候选待评审",
    "descriptionZh": "设计教学教练对话，支持教师反思、目标设定和改进。",
    "mvp": false
  },
  {
    "order": 115,
    "domain": "professional-learning",
    "skill": "lesson-observation-protocol-designer",
    "id": "professional-learning/lesson-observation-protocol-designer",
    "status": "候选待评审",
    "descriptionZh": "设计听课观察协议，明确观察焦点、证据和反馈方式。",
    "mvp": false
  },
  {
    "order": 116,
    "domain": "professional-learning",
    "skill": "lesson-study-cycle-designer",
    "id": "professional-learning/lesson-study-cycle-designer",
    "status": "候选待评审",
    "descriptionZh": "设计 lesson study 循环，包括共同备课、观察、分析和改进。",
    "mvp": false
  },
  {
    "order": 117,
    "domain": "professional-learning",
    "skill": "panel-review",
    "id": "professional-learning/panel-review",
    "status": "候选待评审",
    "descriptionZh": "设计专家评审或小组评审流程，用于课程、项目或作品审查。",
    "mvp": false
  },
  {
    "order": 118,
    "domain": "professional-learning",
    "skill": "pedagogical-content-knowledge-developer",
    "id": "professional-learning/pedagogical-content-knowledge-developer",
    "status": "候选待评审",
    "descriptionZh": "发展教师 PCK，连接学科知识、学生误区和教学策略。",
    "mvp": false
  },
  {
    "order": 119,
    "domain": "professional-learning",
    "skill": "professional-development-session-designer",
    "id": "professional-learning/professional-development-session-designer",
    "status": "候选待评审",
    "descriptionZh": "设计教师专业发展工作坊或培训课。",
    "mvp": false
  },
  {
    "order": 120,
    "domain": "professional-learning",
    "skill": "reflective-practice-prompt-generator",
    "id": "professional-learning/reflective-practice-prompt-generator",
    "status": "候选待评审",
    "descriptionZh": "生成教师反思提示，帮助复盘教学决策和学生证据。",
    "mvp": false
  },
  {
    "order": 121,
    "domain": "professional-learning",
    "skill": "teacher-inquiry-cycle-designer",
    "id": "professional-learning/teacher-inquiry-cycle-designer",
    "status": "候选待评审",
    "descriptionZh": "设计教师行动研究循环，围绕问题、证据、行动和反思展开。",
    "mvp": false
  },
  {
    "order": 122,
    "domain": "professional-learning",
    "skill": "technological-pedagogical-content-knowledge-developer",
    "id": "professional-learning/technological-pedagogical-content-knowledge-developer",
    "status": "候选待评审",
    "descriptionZh": "发展教师 TPACK，整合技术、教学法和学科内容。",
    "mvp": false
  },
  {
    "order": 123,
    "domain": "questioning-discussion",
    "skill": "dialogic-teaching-move-generator",
    "id": "questioning-discussion/dialogic-teaching-move-generator",
    "status": "候选待评审",
    "descriptionZh": "生成对话式教学动作，如追问、转述、连接和邀请证据。",
    "mvp": false
  },
  {
    "order": 124,
    "domain": "questioning-discussion",
    "skill": "discussion-protocol-selector",
    "id": "questioning-discussion/discussion-protocol-selector",
    "status": "候选待评审",
    "descriptionZh": "根据目标选择讨论协议，如辩论、圆桌、鱼缸或同伴讨论。",
    "mvp": false
  },
  {
    "order": 125,
    "domain": "questioning-discussion",
    "skill": "hinge-question-designer",
    "id": "questioning-discussion/hinge-question-designer",
    "status": "候选待评审",
    "descriptionZh": "设计 hinge question，用一个关键问题判断是否进入下一步教学。",
    "mvp": false
  },
  {
    "order": 126,
    "domain": "questioning-discussion",
    "skill": "perspective-taking-designer",
    "id": "questioning-discussion/perspective-taking-designer",
    "status": "候选待评审",
    "descriptionZh": "设计换位思考任务，让学生从不同角色或立场理解问题。",
    "mvp": false
  },
  {
    "order": 127,
    "domain": "questioning-discussion",
    "skill": "socratic-questioning-sequence-generator",
    "id": "questioning-discussion/socratic-questioning-sequence-generator",
    "status": "候选待评审",
    "descriptionZh": "生成苏格拉底式问题序列，引导学生澄清、推理和自我修正。",
    "mvp": false
  },
  {
    "order": 128,
    "domain": "self-regulated-learning",
    "skill": "error-analysis-protocol",
    "id": "self-regulated-learning/error-analysis-protocol",
    "status": "候选待评审",
    "descriptionZh": "设计错误分析流程，让学生识别错误类型、原因和改进动作。",
    "mvp": false
  },
  {
    "order": 129,
    "domain": "self-regulated-learning",
    "skill": "goal-setting-protocol-designer",
    "id": "self-regulated-learning/goal-setting-protocol-designer",
    "status": "候选待评审",
    "descriptionZh": "设计目标设定协议，让学生制定具体、可执行、可检查的学习目标。",
    "mvp": false
  },
  {
    "order": 130,
    "domain": "self-regulated-learning",
    "skill": "metacognitive-prompt-library",
    "id": "self-regulated-learning/metacognitive-prompt-library",
    "status": "候选待评审",
    "descriptionZh": "生成元认知提示库，引导学生计划、监控和评价学习。",
    "mvp": false
  },
  {
    "order": 131,
    "domain": "self-regulated-learning",
    "skill": "self-regulation-scaffold-generator",
    "id": "self-regulated-learning/self-regulation-scaffold-generator",
    "status": "候选待评审",
    "descriptionZh": "生成自我调节学习支架，支持计划、执行、监控和反思。",
    "mvp": false
  },
  {
    "order": 132,
    "domain": "self-regulated-learning",
    "skill": "study-strategy-selector",
    "id": "self-regulated-learning/study-strategy-selector",
    "status": "候选待评审",
    "descriptionZh": "根据目标和内容选择学习策略，如检索练习、间隔复习或自我解释。",
    "mvp": false
  },
  {
    "order": 133,
    "domain": "student-learning",
    "skill": "ai-claim-checker",
    "id": "student-learning/ai-claim-checker",
    "status": "候选待评审",
    "descriptionZh": "要求学生把 AI 输出当作待核查主张，识别可能错误并提出验证方式。",
    "mvp": false
  },
  {
    "order": 134,
    "domain": "student-learning",
    "skill": "explain-first-interrogator",
    "id": "student-learning/explain-first-interrogator",
    "status": "候选待评审",
    "descriptionZh": "要求学生先解释自己的理解或推理，AI 再评价、追问和补充。",
    "mvp": false
  },
  {
    "order": 135,
    "domain": "student-learning",
    "skill": "fading-manager",
    "id": "student-learning/fading-manager",
    "status": "候选待评审",
    "descriptionZh": "管理支架逐步撤除，让学生从依赖提示过渡到独立完成。",
    "mvp": false
  },
  {
    "order": 136,
    "domain": "student-learning",
    "skill": "productive-failure-protocol",
    "id": "student-learning/productive-failure-protocol",
    "status": "候选待评审",
    "descriptionZh": "让学生先尝试并暴露困难，再通过反馈形成更深理解。",
    "mvp": false
  },
  {
    "order": 137,
    "domain": "student-learning",
    "skill": "srl-session-wrapper",
    "id": "student-learning/srl-session-wrapper",
    "status": "候选待评审",
    "descriptionZh": "把一次学习会话包装成自我调节流程：目标、策略、监控和反思。",
    "mvp": false
  },
  {
    "order": 138,
    "domain": "student-learning",
    "skill": "transfer-bridge",
    "id": "student-learning/transfer-bridge",
    "status": "候选待评审",
    "descriptionZh": "在学生理解后设计迁移任务，检查能否把知识用到新情境。",
    "mvp": false
  },
  {
    "order": 139,
    "domain": "student-learning",
    "skill": "unassisted-evidence-checkpoint",
    "id": "student-learning/unassisted-evidence-checkpoint",
    "status": "候选待评审",
    "descriptionZh": "设置无辅助证据检查点，确认学生离开 AI 后仍能独立完成。",
    "mvp": false
  },
  {
    "order": 140,
    "domain": "student-learning",
    "skill": "weekly-agency-review",
    "id": "student-learning/weekly-agency-review",
    "status": "候选待评审",
    "descriptionZh": "每周复盘学生如何使用 AI、何时独立思考、下一步如何更自主。",
    "mvp": false
  },
  {
    "order": 141,
    "domain": "systems-thinking",
    "skill": "agency-circles-for-systems-action",
    "id": "systems-thinking/agency-circles-for-systems-action",
    "status": "候选待评审",
    "descriptionZh": "用影响圈分析学生或团队能控制、影响和关注的系统行动。",
    "mvp": false
  },
  {
    "order": 142,
    "domain": "systems-thinking",
    "skill": "aspirational-systems-iceberg",
    "id": "systems-thinking/aspirational-systems-iceberg",
    "status": "候选待评审",
    "descriptionZh": "用冰山模型分析理想系统背后的事件、模式、结构和心智模型。",
    "mvp": false
  },
  {
    "order": 143,
    "domain": "systems-thinking",
    "skill": "hexagon-complexity-mapper",
    "id": "systems-thinking/hexagon-complexity-mapper",
    "status": "候选待评审",
    "descriptionZh": "用六边形复杂性图谱分析问题的多维因素和相互作用。",
    "mvp": false
  },
  {
    "order": 144,
    "domain": "systems-thinking",
    "skill": "ladder-of-inference-reflection",
    "id": "systems-thinking/ladder-of-inference-reflection",
    "status": "候选待评审",
    "descriptionZh": "用推论阶梯反思自己如何从观察走向判断和行动。",
    "mvp": false
  },
  {
    "order": 145,
    "domain": "systems-thinking",
    "skill": "leverage-and-response-design",
    "id": "systems-thinking/leverage-and-response-design",
    "status": "候选待评审",
    "descriptionZh": "识别系统杠杆点并设计回应策略。",
    "mvp": false
  },
  {
    "order": 146,
    "domain": "systems-thinking",
    "skill": "mental-model-mapper",
    "id": "systems-thinking/mental-model-mapper",
    "status": "候选待评审",
    "descriptionZh": "绘制心智模型，显性化人们对系统如何运行的假设。",
    "mvp": false
  },
  {
    "order": 147,
    "domain": "systems-thinking",
    "skill": "systems-awareness-iceberg",
    "id": "systems-thinking/systems-awareness-iceberg",
    "status": "候选待评审",
    "descriptionZh": "用系统冰山分析事件、趋势、结构和深层信念。",
    "mvp": false
  },
  {
    "order": 148,
    "domain": "systems-thinking",
    "skill": "systems-wellbeing-impact-mapper",
    "id": "systems-thinking/systems-wellbeing-impact-mapper",
    "status": "候选待评审",
    "descriptionZh": "分析系统设计对幸福感、关系和长期影响的作用。",
    "mvp": false
  },
  {
    "order": 149,
    "domain": "wellbeing-motivation-agency",
    "skill": "agency-scaffold-generator",
    "id": "wellbeing-motivation-agency/agency-scaffold-generator",
    "status": "候选待评审",
    "descriptionZh": "生成学生能动性支架，帮助学生做选择、设目标和承担责任。",
    "mvp": false
  },
  {
    "order": 150,
    "domain": "wellbeing-motivation-agency",
    "skill": "awe-wonder-experience-designer",
    "id": "wellbeing-motivation-agency/awe-wonder-experience-designer",
    "status": "候选待评审",
    "descriptionZh": "设计惊奇和好奇体验，提升学习动机和探究欲。",
    "mvp": false
  },
  {
    "order": 151,
    "domain": "wellbeing-motivation-agency",
    "skill": "belonging-classroom-culture-designer",
    "id": "wellbeing-motivation-agency/belonging-classroom-culture-designer",
    "status": "候选待评审",
    "descriptionZh": "设计归属感课堂文化，让学生感到被看见、被接纳和能参与。",
    "mvp": false
  },
  {
    "order": 152,
    "domain": "wellbeing-motivation-agency",
    "skill": "flow-state-condition-designer",
    "id": "wellbeing-motivation-agency/flow-state-condition-designer",
    "status": "候选待评审",
    "descriptionZh": "设计心流条件，使挑战、技能、目标和反馈保持平衡。",
    "mvp": false
  },
  {
    "order": 153,
    "domain": "wellbeing-motivation-agency",
    "skill": "implementation-intention-designer",
    "id": "wellbeing-motivation-agency/implementation-intention-designer",
    "status": "候选待评审",
    "descriptionZh": "设计执行意图，把目标转化为“如果...那么...”行动计划。",
    "mvp": false
  },
  {
    "order": 154,
    "domain": "wellbeing-motivation-agency",
    "skill": "motivation-diagnostic-task-redesign",
    "id": "wellbeing-motivation-agency/motivation-diagnostic-task-redesign",
    "status": "候选待评审",
    "descriptionZh": "诊断任务动机问题并重新设计任务，提高价值感、自主性和胜任感。",
    "mvp": false
  },
  {
    "order": 155,
    "domain": "wellbeing-motivation-agency",
    "skill": "perma-based-lesson-designer",
    "id": "wellbeing-motivation-agency/perma-based-lesson-designer",
    "status": "候选待评审",
    "descriptionZh": "按 PERMA 框架设计课程，兼顾积极情绪、投入、关系、意义和成就。",
    "mvp": false
  },
  {
    "order": 156,
    "domain": "wellbeing-motivation-agency",
    "skill": "restorative-practice-protocol-designer",
    "id": "wellbeing-motivation-agency/restorative-practice-protocol-designer",
    "status": "候选待评审",
    "descriptionZh": "设计修复式实践流程，用对话修复关系和责任。",
    "mvp": false
  },
  {
    "order": 157,
    "domain": "wellbeing-motivation-agency",
    "skill": "ruler-emotional-literacy-sequence",
    "id": "wellbeing-motivation-agency/ruler-emotional-literacy-sequence",
    "status": "候选待评审",
    "descriptionZh": "设计 RULER 情绪素养序列，训练识别、理解、命名、表达和调节情绪。",
    "mvp": false
  },
  {
    "order": 158,
    "domain": "wellbeing-motivation-agency",
    "skill": "self-efficacy-builder-sequence",
    "id": "wellbeing-motivation-agency/self-efficacy-builder-sequence",
    "status": "候选待评审",
    "descriptionZh": "设计自我效能感提升序列，通过成功经验、反馈和策略建立信心。",
    "mvp": false
  },
  {
    "order": 159,
    "domain": "wellbeing-motivation-agency",
    "skill": "trauma-informed-practice-designer",
    "id": "wellbeing-motivation-agency/trauma-informed-practice-designer",
    "status": "候选待评审",
    "descriptionZh": "设计创伤知情教学实践，关注安全、选择、信任和稳定性。",
    "mvp": false
  },
  {
    "order": 160,
    "domain": "wellbeing-motivation-agency",
    "skill": "wellbeing-learning-connection-mapper",
    "id": "wellbeing-motivation-agency/wellbeing-learning-connection-mapper",
    "status": "候选待评审",
    "descriptionZh": "映射幸福感与学习之间的关系，识别支持学习的情绪和环境因素。",
    "mvp": false
  }
];
