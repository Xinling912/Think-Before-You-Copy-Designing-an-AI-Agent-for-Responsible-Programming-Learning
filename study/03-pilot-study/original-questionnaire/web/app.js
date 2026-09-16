// Public research snapshot: the original data-collection endpoint is intentionally redacted.
const SUBMISSION_ENDPOINT = "";
const RESPONDENT_ID_KEY = "responsibleEduAgentPilotRespondentId";
const LOCAL_PROGRESS_KEY = "responsibleEduAgentPilotProgress";

const queryParams = new URLSearchParams(window.location.search);
const hashCommand = window.location.hash.replace("#", "").toLowerCase();
if (queryParams.has("new") || queryParams.has("reset") || hashCommand === "new" || hashCommand === "reset") {
  localStorage.removeItem(RESPONDENT_ID_KEY);
  localStorage.removeItem(LOCAL_PROGRESS_KEY);
  window.history.replaceState({}, document.title, window.location.pathname);
}

const INVALID_TEXT_RESPONSES = new Set([
  "无",
  "没有",
  "没",
  "不知道",
  "不清楚",
  "不了解",
  "无理由",
  "没理由",
  "没什么",
  "不懂",
  "none",
  "no",
  "nothing",
  "n/a",
  "na",
  "idk",
  "dontknow",
  "don'tknow",
  "i don't know",
  "unknown",
]);

const screens = [
  {
    id: "welcome",
    type: "welcome",
    title: "ResponsibleEduAgent Pilot Study",
    titleCn: "ResponsibleEduAgent 试点研究",
    body:
      "Please complete each page before continuing. This pilot study is not a test of your programming ability; it evaluates how the agent supports responsible AI-assisted programming learning.",
    bodyCn:
      "请完成当前页面后继续。本试点研究并非测试你的编程能力，而是评估该智能体如何支持负责任的 AI 辅助编程学习。",
  },
  {
    id: "consent",
    type: "consent",
    topLabel: "Consent Form / 知情同意说明",
    title: "Consent Form",
    titleCn: "知情同意说明",
    paragraphs: [
      [
        "Before participating in this pilot study, please read the following information and confirm your consent.",
        "在参与本次试点研究之前，请阅读以下说明并确认你的同意。",
      ],
      [
        "This study aims to understand how students use ResponsibleEduAgent in programming learning tasks. The session will take approximately 15-18 minutes.",
        "本研究旨在了解学生如何在编程学习任务中使用 ResponsibleEduAgent。整个过程约需 15-18 分钟。",
      ],
      [
        "Your participation is voluntary. You may stop at any time without any negative consequences.",
        "你的参与完全自愿。你可以在任何时候退出，且不会产生任何负面后果。",
      ],
      [
        "Your questionnaire responses, task choices, and written feedback will be used only for academic research and will be anonymized before analysis.",
        "你的问卷回答、任务选择和文字反馈仅用于学术研究，并会在分析前进行匿名化处理。",
      ],
    ],
    confirmations: [
      ["read_understood", "I have read and understood the study information.", "我已阅读并理解本研究说明。"],
      ["voluntary", "I understand that participation is voluntary and I may withdraw at any time.", "我了解参与是自愿的，并且我可以在任何时候退出。"],
      ["research_use", "I understand that my responses will be used for research purposes only and anonymized.", "我了解我的回答仅用于研究目的，并将进行匿名化处理。"],
      ["agree", "I agree to participate in this pilot study.", "我同意参与本次试点研究。"],
    ],
  },
  {
    id: "D1",
    type: "choice",
    topLabel: "Demographic and Background / 人口统计与背景",
    en: "D1. Your age range",
    cn: "你的年龄段：",
    options: [
      ["18_24", "18-24", "18-24 岁"],
      ["25_34", "25-34", "25-34 岁"],
      ["35_44", "35-44", "35-44 岁"],
      ["45_plus", "45 or above", "45 岁及以上"],
      ["prefer_not_to_tell", "Prefer not to tell", "不愿透露"],
    ],
  },
  {
    id: "D2",
    type: "choice",
    topLabel: "Demographic and Background / 人口统计与背景",
    en: "D2. Your major or field of study",
    cn: "你的专业或学习领域：",
    options: [
      ["stem_cs", "STEM / Computer-related", "理工科 / 计算机相关"],
      ["stem_non_cs", "STEM / Non-computer-related", "理工科 / 非计算机相关"],
      ["humanities_social", "Humanities or Social Sciences", "人文社科"],
      ["business", "Business or Management", "商科 / 管理"],
      ["other", "Other", "其他"],
    ],
  },
  {
    id: "D3",
    type: "choice",
    topLabel: "Demographic and Background / 人口统计与背景",
    en: "D3. Your current study level",
    cn: "你目前的学习阶段：",
    options: [
      ["undergraduate", "Undergraduate", "本科生"],
      ["master", "Master student", "硕士研究生"],
      ["doctoral", "Doctoral student", "博士研究生"],
      ["other", "Other", "其他"],
    ],
  },
  {
    id: "D4",
    type: "choice",
    topLabel: "Programming Background / 编程背景",
    en: "D4. How familiar are you with Python programming?",
    cn: "你对 Python 编程的熟悉程度如何？",
    options: [
      ["1", "1 Not familiar at all", "1 完全不熟悉"],
      ["2", "2 Slightly familiar", "2 稍微熟悉"],
      ["3", "3 Moderately familiar", "3 一般熟悉"],
      ["4", "4 Familiar", "4 比较熟悉"],
      ["5", "5 Very familiar", "5 非常熟悉"],
    ],
  },
  {
    id: "D5",
    type: "choice",
    topLabel: "Programming Background / 编程背景",
    en: "D5. How long have you been learning or using programming?",
    cn: "你学习或使用编程有多长时间？",
    options: [
      ["lt_6_months", "Less than 6 months", "少于 6 个月"],
      ["6_12_months", "6-12 months", "6-12 个月"],
      ["1_2_years", "1-2 years", "1-2 年"],
      ["gt_2_years", "More than 2 years", "2 年以上"],
    ],
  },
  {
    id: "D6",
    type: "choice",
    topLabel: "AI Use Background / AI 使用背景",
    en: "D6. How often do you use generative AI tools for programming?",
    cn: "你使用生成式 AI 工具辅助编程的频率如何？",
    options: [
      ["never", "Never", "从不"],
      ["monthly_or_less", "Monthly or less", "每月或更少"],
      ["weekly", "Weekly", "每周"],
      ["daily", "Daily or almost daily", "每天或几乎每天"],
    ],
  },
  {
    id: "D7",
    type: "choice",
    topLabel: "AI Use Background / AI 使用背景",
    en: "D7. Have you used AI coding agents before?",
    cn: "你以前是否使用过 AI 编程智能体？",
    options: [
      ["yes", "Yes", "是"],
      ["no", "No", "否"],
      ["not_sure", "Not sure", "不确定"],
    ],
  },
  {
    id: "T1",
    type: "task",
    topLabel: "Main Task 1 / 主任务 1",
    title: "T1. Code Reading with Agent Support",
    titleCn: "T1. 使用智能体辅助代码阅读",
    code: `colors = ["red", "blue", "green"]
print(colors[0])
print(colors[2])`,
    givenOutput: `red
green`,
    steps: [
      ["Open a new ResponsibleEduAgent session.", "打开一个新的 ResponsibleEduAgent 对话。"],
      [
        'Copy this exact question into the agent: "Python list indexing example: colors = [\'red\', \'blue\', \'green\']. Why do colors[0] and colors[2] produce red and green? Please guide me step by step and ask me to identify the indexes before explaining."',
        "将这个问题完整复制给智能体：“关于 Python 列表索引，请看 colors = ['red', 'blue', 'green']。为什么 colors[0] 和 colors[2] 会输出 red 和 green？请一步一步引导我，并先让我判断索引，再进行解释。”",
      ],
      [
        "Read the Agent's current question carefully and answer it in your own words. If it asks for a confidence rating, give your actual score from 1 to 5. If it asks about code or a concept, answer based on your current understanding. If you are unsure, say so and ask it to continue guiding you.",
        "认真阅读智能体当前提出的问题，并用自己的话回答。如果它询问信心程度，请给出真实的 1–5 分；如果它询问代码或概念，请根据当前理解回答；如果不确定，可以直接说明并请它继续引导。",
      ],
      [
        "Repeat the previous step once more: answer the Agent's next question, then read its following response. Stop after you have answered two Agent questions.",
        "再重复一次上一步：回答智能体接下来提出的问题，并阅读它随后的回复。完成两次回答后停止对话。",
      ],
      [
        "Expand Knowledge path and check whether list, index, or zero-based index appears.",
        "展开 Knowledge path（知识路径），查看是否出现 list、index 或 zero-based index。",
      ],
      [
        "Click View in Knowledge World, then click index or zero-based index to inspect its related nodes and learning paths.",
        "点击 View in Knowledge World，再点击 index 或 zero-based index，查看相关节点和学习路径。",
      ],
    ],
    scaleLeft: ["Not helpful at all", "完全没有帮助"],
    scaleRight: ["Very helpful", "非常有帮助"],
    evaluations: [
      {
        id: "agent",
        question:
          "To what extent did the agent as a whole help you understand Python list indexing?",
        questionCn:
          "智能体整体在多大程度上帮助你理解 Python 列表索引？",
        explanationPrompt:
          "Please explain your rating of the agent as a whole.",
        explanationPromptCn:
          "请解释你对智能体整体的评分。",
      },
      {
        id: "knowledgeGraph",
        question:
          "To what extent did the knowledge graph help you understand the concepts and relationships related to Python list indexing?",
        questionCn:
          "知识图谱在多大程度上帮助你理解与 Python 列表索引相关的概念及其关系？",
        explanationPrompt:
          "Please explain your rating of the knowledge graph.",
        explanationPromptCn:
          "请解释你对知识图谱的评分。",
      },
    ],
  },
  {
    id: "T2",
    type: "task",
    topLabel: "Main Task 2 / 主任务 2",
    title: "T2. Debugging with Agent Support",
    titleCn: "T2. 使用智能体辅助调试",
    code: `numbers = [10, 20, 30]
print(numbers[3])`,
    errorMessage: "IndexError: list index out of range",
    steps: [
      ["Open a new ResponsibleEduAgent session.", "打开一个新的 ResponsibleEduAgent 对话。"],
      [
        'Copy this exact question into the agent: "The code numbers = [10, 20, 30]; print(numbers[3]) raises IndexError: list index out of range. Please guide me to diagnose it step by step instead of only giving corrected code. Ask me to identify the valid indexes first."',
        "将这个问题完整复制给智能体：“代码 numbers = [10, 20, 30]; print(numbers[3]) 报错 IndexError: list index out of range。请一步一步引导我诊断，不要只给出修改后的代码。请先让我判断有效索引。”",
      ],
      [
        "Read the Agent's current question carefully and answer it in your own words. If it asks for a confidence rating, give your actual score from 1 to 5. If it asks about code or a concept, answer based on your current understanding. If you are unsure, say so and ask it to continue guiding you.",
        "认真阅读智能体当前提出的问题，并用自己的话回答。如果它询问信心程度，请给出真实的 1–5 分；如果它询问代码或概念，请根据当前理解回答；如果不确定，可以直接说明并请它继续引导。",
      ],
      [
        "Repeat the previous step once more: answer the Agent's next question, then read its following response. Stop after you have answered two Agent questions.",
        "再重复一次上一步：回答智能体接下来提出的问题，并阅读它随后的回复。完成两次回答后停止对话。",
      ],
      [
        "Expand Knowledge path and check whether list, index, zero-based index, valid index range, or IndexError appears.",
        "展开 Knowledge path（知识路径），查看是否出现 list、index、zero-based index、valid index range 或 IndexError。",
      ],
      [
        "Click View in Knowledge World, then click IndexError or valid index range to inspect its related nodes and learning paths.",
        "点击 View in Knowledge World，再点击 IndexError 或 valid index range，查看相关节点和学习路径。",
      ],
    ],
    scaleLeft: ["Not helpful at all", "完全没有帮助"],
    scaleRight: ["Very helpful", "非常有帮助"],
    evaluations: [
      {
        id: "agent",
        question:
          "To what extent did the agent as a whole help you diagnose the IndexError?",
        questionCn:
          "智能体整体在多大程度上帮助你诊断这个 IndexError？",
        explanationPrompt:
          "Please explain your rating of the agent as a whole.",
        explanationPromptCn:
          "请解释你对智能体整体的评分。",
      },
      {
        id: "knowledgeGraph",
        question:
          "To what extent did the knowledge graph help you understand the concepts and relationships relevant to diagnosing the IndexError?",
        questionCn:
          "知识图谱在多大程度上帮助你理解诊断这个 IndexError 所涉及的概念及其关系？",
        explanationPrompt:
          "Please explain your rating of the knowledge graph.",
        explanationPromptCn:
          "请解释你对知识图谱的评分。",
      },
    ],
  },
  {
    id: "P",
    type: "likert",
    topLabel: "Post-questionnaire / 后测问卷",
    title: "Please rate the following statements based on your experience in the two tasks.",
    titleCn: "请根据你在两个任务中的体验，对以下陈述进行评分。",
    items: [
      ["P1", "The agent guided me to think through the problem rather than directly giving me the final answer.", "该智能体引导我思考问题，而不是直接给出最终答案。"],
      ["P2", "The agent made it easier for me to judge whether its explanation was reliable.", "该智能体让我更容易判断它的解释是否可靠。"],
      ["P3", "The agent helped me understand the programming concept or error involved in the task.", "该智能体帮助我理解任务中的编程概念或错误原因。"],
      ["P4", "The interaction with the agent was clear and easy to follow.", "与该智能体的交互清晰且容易跟随。"],
      ["P5", "I would consider using this agent for future programming learning tasks.", "未来进行编程学习任务时，我会考虑使用这个智能体。"],
    ],
  },
  {
    id: "O",
    type: "open",
    topLabel: "Open Feedback / 开放反馈",
    title: "Final Feedback",
    titleCn: "最终反馈",
    questions: [
      [
        "O1",
        "What did the agent do well in supporting your programming learning? Please explain why.",
        "你认为该智能体在哪些方面较好地支持了你的编程学习？请说明原因。",
      ],
      [
        "O2",
        "What should be improved to better support responsible AI-assisted programming learning?",
        "为了更好地支持负责任的 AI 辅助编程学习，你认为它还需要改进什么？",
      ],
    ],
  },
  {
    id: "complete",
    type: "complete",
    title: "Thank you!",
    titleCn: "感谢参与！",
    body: "Your pilot study response has been submitted.",
    bodyCn: "你的试点研究回答已提交。",
  },
];

let state = loadState();
let currentIndex = Math.min(state.currentIndex || 0, screens.length - 1);
let isAdvancing = false;

const screenEl = document.getElementById("screen");
const stepLabel = document.getElementById("stepLabel");
const progressLabel = document.getElementById("progressLabel");
const nextButton = document.getElementById("nextButton");
const validationMessage = document.getElementById("validationMessage");
const saveStatus = document.getElementById("saveStatus");

render();

nextButton.addEventListener("click", async () => {
  if (isAdvancing) return;
  const screen = screens[currentIndex];
  if (screen.type === "complete") {
    startNewResponse();
    return;
  }
  if (!collectScreen(screen)) {
    validate();
    return;
  }

  isAdvancing = true;
  nextButton.disabled = true;

  try {
    state.completedScreens = Array.from(new Set([...(state.completedScreens || []), screen.id]));
    state.lastCompletedScreenId = screen.id;
    state.currentScreenId = screen.id;
    saveState();

    if (!["welcome", "complete"].includes(screen.id)) {
      await submitProgress(screen.id === "O");
    }

    currentIndex = Math.min(currentIndex + 1, screens.length - 1);
    state.currentIndex = currentIndex;
    state.currentScreenId = screens[currentIndex].id;
    saveState();
    render();
  } finally {
    isAdvancing = false;
    validate();
  }
});

function render() {
  const screen = screens[currentIndex];
  stepLabel.textContent = screen.topLabel || "Pilot Study";
  progressLabel.textContent = `${Math.min(currentIndex + 1, screens.length)}/${screens.length}`;
  validationMessage.textContent = "";
  saveStatus.textContent = "";

  if (screen.type === "welcome") renderWelcome(screen);
  if (screen.type === "consent") renderConsent(screen);
  if (screen.type === "choice") renderChoice(screen);
  if (screen.type === "task") renderTask(screen);
  if (screen.type === "likert") renderLikert(screen);
  if (screen.type === "open") renderOpen(screen);
  if (screen.type === "complete") renderComplete(screen);

  nextButton.textContent = screen.type === "complete"
    ? "Start a new response / 开始新的答卷"
    : screen.id === "O"
      ? "Submit"
      : "Continue";
  nextButton.disabled = false;
  screenEl.querySelectorAll("input, textarea").forEach((el) => {
    el.addEventListener("input", validate);
    el.addEventListener("change", validate);
  });
  validate();
}

function renderWelcome(screen) {
  screenEl.innerHTML = `
    <p class="kicker">Pilot Study</p>
    <h1>${screen.title}<span class="cn-title">${screen.titleCn}</span></h1>
    <p class="intro">${screen.body}<br>${screen.bodyCn}</p>
  `;
}

function renderConsent(screen) {
  screenEl.innerHTML = `
    <div class="copy">
      <h2>${screen.title}<span class="cn-title">${screen.titleCn}</span></h2>
      ${screen.paragraphs.map(([en, cn]) => `<p><span>${en}</span><span>${cn}</span></p>`).join("")}
    </div>
    <div class="options">
      ${screen.confirmations.map(([value, en, cn]) => optionHtml("checkbox", "consent", value, en, cn)).join("")}
    </div>
  `;
  restoreConsent();
}

function renderChoice(screen) {
  screenEl.innerHTML = `
    <div class="question-title"><span class="en">${screen.en}</span><span class="cn">${screen.cn}</span></div>
    <div class="options">
      ${screen.options.map(([value, en, cn]) => optionHtml("radio", screen.id, value, en, cn)).join("")}
    </div>
  `;
  restoreChoice(screen.id);
}

function renderTask(screen) {
  screenEl.innerHTML = `
    <section class="task-card">
      <h2>${screen.title}<span class="cn-title">${screen.titleCn}</span></h2>
      ${screen.scenario ? `<div class="task-block"><strong>Scenario / 情境</strong><span>${screen.scenario}</span><br><span class="muted">${screen.scenarioCn}</span></div>` : ""}
      <div class="task-block"><strong>Code / 代码</strong><pre><code>${escapeHtml(screen.code)}</code></pre></div>
      ${screen.givenOutput ? `<div class="task-block"><strong>Given output / 已知输出</strong><div class="given-output">${escapeHtml(screen.givenOutput)}</div></div>` : ""}
      ${screen.errorMessage ? `<div class="task-block"><strong>Error message / 报错信息</strong><div class="given-output">${screen.errorMessage}</div></div>` : ""}
      <div class="task-block"><strong>Task / 任务</strong>
        ${screen.instruction ? `<span>${screen.instruction}</span><br><span class="muted">${screen.instructionCn}</span>` : ""}
        <ol>${screen.steps.map(([en, cn]) => `<li>${en}<br><span class="muted">${cn}</span></li>`).join("")}</ol>
      </div>
      <div class="task-evaluations">
        ${screen.evaluations.map((evaluation) => `
          <section class="task-evaluation">
            <div class="task-rating">
              <strong>${evaluation.question}</strong>
              <span class="muted rating-cn">${evaluation.questionCn}</span>
              <div class="scale task-scale">${scaleHtml(`${screen.id}_${evaluation.id}_rating`, screen.scaleLeft, screen.scaleRight)}</div>
            </div>
            <div class="task-explanation">
              <strong>${evaluation.explanationPrompt}</strong>
              <span class="muted">${evaluation.explanationPromptCn}</span>
              <textarea id="${screen.id}_${evaluation.id}_explanation" placeholder="Please write your explanation here. / 请在此填写解释。"></textarea>
            </div>
          </section>
        `).join("")}
      </div>
    </section>
  `;
  restoreTask(screen.id);
}

function renderLikert(screen) {
  screenEl.innerHTML = `
    <div class="question-title"><span class="en">${screen.title}</span><span class="cn">${screen.titleCn}</span></div>
    <table class="scale-table">
      <colgroup>
        <col class="col-item">
        <col class="col-statement">
        <col class="col-rating">
      </colgroup>
      <thead><tr><th>Item<br>题号</th><th>Statement<br>陈述</th><th>Rating<br>评分</th></tr></thead>
      <tbody>
        ${screen.items.map(([id, en, cn]) => `
          <tr>
            <td class="item">${id}</td>
            <td><strong class="statement-en">${en}</strong><span class="muted statement-cn">${cn}</span></td>
            <td class="rating">${scaleHtml(id)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  restoreLikert(screen);
}

function renderOpen(screen) {
  screenEl.innerHTML = `
    <div class="question-title"><span class="en">${screen.title}</span><span class="cn">${screen.titleCn}</span></div>
    ${screen.questions.map(([id, en, cn]) => `
      <div class="task-block">
        <strong>${id}. ${en}</strong>
        <span class="muted">${cn}</span>
        <textarea id="${id}" placeholder="Please explain your answer. / 请说明你的回答。"></textarea>
      </div>
    `).join("")}
  `;
  restoreOpen(screen);
}

function renderComplete(screen) {
  screenEl.innerHTML = `
    <div class="complete">
      <h1>${screen.title}<span class="cn-title">${screen.titleCn}</span></h1>
      <p class="intro">${screen.body}<br>${screen.bodyCn}</p>
    </div>
  `;
}

function optionHtml(type, name, value, en, cn) {
  return `
    <label class="option">
      <input type="${type}" name="${name}" value="${value}">
      <span class="option-text"><span>${en}</span>${cn ? `<span class="cn">${cn}</span>` : ""}</span>
    </label>
  `;
}

function scaleHtml(itemId, leftLabel = ["Strongly disagree", "非常不同意"], rightLabel = ["Strongly agree", "非常同意"]) {
  return `
    <div class="scale-row">
      <span class="scale-end left">${leftLabel[0]}<br>${leftLabel[1]}</span>
      ${[1, 2, 3, 4, 5].map((value) => `
        <label class="scale-option">
          <input type="radio" name="${itemId}" value="${value}">
          ${value}
        </label>
      `).join("")}
      <span class="scale-end right">${rightLabel[0]}<br>${rightLabel[1]}</span>
    </div>
  `;
}

function collectScreen(screen) {
  if (screen.type === "welcome") return true;
  if (screen.type === "consent") {
    const values = Array.from(screenEl.querySelectorAll('input[name="consent"]:checked')).map((input) => input.value);
    state.answers.consent = { value: values };
    return values.length === screen.confirmations.length;
  }
  if (screen.type === "choice") {
    const checked = screenEl.querySelector(`input[name="${screen.id}"]:checked`);
    state.answers[screen.id] = { value: checked ? checked.value : "" };
    return Boolean(checked);
  }
  if (screen.type === "task") {
    const evaluations = {};
    screen.evaluations.forEach((evaluation) => {
      const checked = screenEl.querySelector(
        `input[name="${screen.id}_${evaluation.id}_rating"]:checked`,
      );
      const explanation = document
        .getElementById(`${screen.id}_${evaluation.id}_explanation`)
        .value.trim();
      evaluations[evaluation.id] = {
        rating: checked ? Number(checked.value) : "",
        explanation,
      };
    });
    state.answers[screen.id] = {
      evaluations,
      code: screen.code,
      givenOutput: screen.givenOutput || "",
      errorMessage: screen.errorMessage || "",
      taskPrompt: screen.instruction,
    };
    return Object.values(evaluations).every(
      (evaluation) =>
        Boolean(evaluation.rating) && isMeaningfulText(evaluation.explanation),
    );
  }
  if (screen.type === "likert") {
    const values = {};
    screen.items.forEach(([id]) => {
      const checked = screenEl.querySelector(`input[name="${id}"]:checked`);
      if (checked) values[id] = Number(checked.value);
    });
    state.answers[screen.id] = { values };
    return Object.keys(values).length === screen.items.length;
  }
  if (screen.type === "open") {
    const values = {};
    screen.questions.forEach(([id]) => {
      values[id] = document.getElementById(id).value.trim();
    });
    state.answers[screen.id] = { values };
    return Object.values(values).every(isMeaningfulText);
  }
  return true;
}

function validate() {
  const screen = screens[currentIndex];
  const valid = collectScreen(screen);
  nextButton.disabled = !valid || isAdvancing;
  if (!valid) {
    if (screen.type === "task") {
      validationMessage.textContent = "Please rate both the agent and the knowledge graph, and explain both ratings. / 请分别对智能体和知识图谱评分，并解释两个评分。";
    } else if (screen.type === "open") {
      validationMessage.textContent = "Please answer both open-ended questions. / 请回答两道开放题。";
    } else if (screen.type === "consent") {
      validationMessage.textContent = "Please tick all consent boxes to continue. / 请勾选所有知情同意选项后继续。";
    } else {
      validationMessage.textContent = "Please complete this page before continuing. / 请完成本页后继续。";
    }
  } else {
    validationMessage.textContent = "";
  }
  saveState();
}

function isMeaningfulText(value) {
  const raw = String(value || "").trim();
  if (raw.length === 0) return false;
  const normalized = raw.toLowerCase().replace(/\s+/g, "").replace(/[。.!！?？,，、]/g, "");
  return !INVALID_TEXT_RESPONSES.has(normalized);
}

function restoreConsent() {
  const values = state.answers.consent?.value || [];
  values.forEach((value) => {
    const input = screenEl.querySelector(`input[value="${value}"]`);
    if (input) input.checked = true;
  });
}

function restoreChoice(id) {
  const value = state.answers[id]?.value;
  if (!value) return;
  const input = screenEl.querySelector(`input[name="${id}"][value="${value}"]`);
  if (input) input.checked = true;
}

function restoreTask(id) {
  const answer = state.answers[id] || {};
  const screen = screens.find((candidate) => candidate.id === id);
  if (!screen?.evaluations) return;
  screen.evaluations.forEach((evaluation) => {
    const saved = answer.evaluations?.[evaluation.id] || {};
    if (saved.rating) {
      const input = screenEl.querySelector(
        `input[name="${id}_${evaluation.id}_rating"][value="${saved.rating}"]`,
      );
      if (input) input.checked = true;
    }
    const textarea = document.getElementById(
      `${id}_${evaluation.id}_explanation`,
    );
    if (textarea) textarea.value = saved.explanation || "";
  });
}

function restoreLikert(screen) {
  const values = state.answers[screen.id]?.values || {};
  Object.entries(values).forEach(([id, value]) => {
    const input = screenEl.querySelector(`input[name="${id}"][value="${value}"]`);
    if (input) input.checked = true;
  });
}

function restoreOpen(screen) {
  const values = state.answers[screen.id]?.values || {};
  Object.entries(values).forEach(([id, value]) => {
    const textarea = document.getElementById(id);
    if (textarea) textarea.value = value;
  });
}

async function submitProgress(isFinal) {
  if (!SUBMISSION_ENDPOINT || SUBMISSION_ENDPOINT.includes("PASTE_TENCENT")) {
    saveStatus.textContent = "Local progress saved. Tencent Cloud endpoint is not configured yet. / 已保存到本机，腾讯云接口尚未配置。";
    return;
  }
  const payload = {
    respondentId: state.respondentId,
    submittedAt: new Date().toISOString(),
    currentScreenId: state.currentScreenId || screens[currentIndex].id,
    lastCompletedScreenId: state.lastCompletedScreenId || "",
    completedScreens: state.completedScreens || [],
    answers: state.answers,
    isFinal,
    endedEarly: false,
    endReason: "",
    source: "responsibleeduagent-pilot-study",
  };
  try {
    saveStatus.textContent = "Saving... / 正在保存...";
    const response = await fetch(SUBMISSION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    saveStatus.textContent = "Saved. / 已保存。";
  } catch (error) {
    saveStatus.textContent = "Save failed. Your local progress is kept in this browser. / 保存失败，本机浏览器仍保留进度。";
    console.error(error);
  }
}

function loadState() {
  const existing = localStorage.getItem(LOCAL_PROGRESS_KEY);
  if (existing) {
    try {
      const parsed = JSON.parse(existing);
      if (parsed && parsed.respondentId) return parsed;
    } catch (error) {
      console.warn("Invalid local progress, starting over.", error);
    }
  }
  return {
    respondentId: getOrCreateRespondentId(),
    currentIndex: 0,
    currentScreenId: "welcome",
    lastCompletedScreenId: "",
    completedScreens: [],
    answers: {},
  };
}

function saveState() {
  localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(state));
}

function startNewResponse() {
  localStorage.removeItem(RESPONDENT_ID_KEY);
  localStorage.removeItem(LOCAL_PROGRESS_KEY);
  state = loadState();
  currentIndex = 0;
  render();
}

function getOrCreateRespondentId() {
  let id = localStorage.getItem(RESPONDENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `pilot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(RESPONDENT_ID_KEY, id);
  }
  return id;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
