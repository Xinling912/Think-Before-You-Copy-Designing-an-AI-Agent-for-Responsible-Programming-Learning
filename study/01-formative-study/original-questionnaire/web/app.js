const END_TRIGGERS = new Set([
  "A4_no_never",
  "A5_none",
  "A7_never",
  "A8_never",
  "A9_never",
]);

const INVALID_EXPLANATIONS = new Set([
  "无",
  "没有",
  "没",
  "不知道",
  "不清楚",
  "不了解",
  "无理由",
  "没理由",
  "没什么",
  "none",
  "no",
  "nothing",
  "n/a",
  "na",
  "idk",
  "dontknow",
  "don'tknow",
]);

// Public OSF snapshot: the live data-submission endpoint is intentionally redacted.
const SUBMISSION_ENDPOINT = "";
const LOCAL_PROGRESS_KEY = "questionnaireProgress";

const screens = [
  {
    id: "welcome",
    type: "welcome",
    title: "AI Programming Learning Questionnaire",
    titleCn: "AI 编程学习问卷",
    body:
      "Please complete each page before continuing. Once you continue, you cannot return to previous pages.",
    bodyCn: "请完成当前页面后继续。进入下一页后不可返回上一页。",
  },
  {
    id: "consent",
    type: "consent",
    topLabel: "Consent Form / 知情同意说明",
    title: "Consent Form",
    titleCn: "知情同意说明",
    paragraphs: [
      [
        "Before participating in this questionnaire, please read the following information and confirm your consent.",
        "在参与本问卷之前，请您阅读以下说明并确认您的同意。",
      ],
      [
        "This study aims to understand students' experience and perceptions of using AI tools for programming learning. The questionnaire will take approximately 10-15 minutes.",
        "本研究旨在了解学生使用 AI 工具进行编程学习的体验与看法。问卷填写大约需要 10-15 分钟。",
      ],
      [
        "All responses will be used for academic research only and will be processed anonymously. Your personal identity will not be disclosed.",
        "所有回答仅用于学术研究，并将以匿名形式进行处理，不会泄露您的个人身份信息。",
      ],
      [
        "Your participation is completely voluntary. You may stop answering at any time without any negative consequences.",
        "您的参与完全自愿，您可以在任何时候停止作答，而不会产生任何不利影响。",
      ],
      [
        "If you agree to participate in this study, please tick all boxes below.",
        "如果您同意参与本研究，请勾选下方所有选项。",
      ],
    ],
    confirmations: [
      [
        "read_understood",
        "I have read and understood the study information and agree to participate in this questionnaire.",
        "我已阅读并理解本研究说明，并同意参与本问卷。",
      ],
      [
        "research_use",
        "I understand that my responses will be used for academic research only and will be anonymized.",
        "我知晓我的回答将仅用于学术研究，并会以匿名形式处理。",
      ],
      [
        "voluntary",
        "I understand that I can stop answering at any time without any consequences.",
        "我了解我可以在任何时候停止作答，而无需承担任何后果。",
      ],
    ],
  },
  {
    id: "A1",
    type: "choice",
    topLabel: "Demographic Information / 人口统计信息",
    en: "A1. Your gender",
    cn: "你的性别：",
    required: true,
    multiple: false,
    options: [
      ["male", "Male", "男性"],
      ["female", "Female", "女性"],
      ["non_binary", "Non-binary", "非二元性别"],
      ["prefer_not_to_tell", "Prefer not to tell", "不愿透露"],
    ],
  },
  {
    id: "A2",
    type: "choice",
    topLabel: "Demographic Information / 人口统计信息",
    en: "A2. Your age range",
    cn: "你的年龄段：",
    required: true,
    multiple: false,
    options: [
      ["18_24", "18-24", ""],
      ["25_34", "25-34", ""],
      ["35_44", "35-44", ""],
      ["45_54", "45-54", ""],
      ["55_64", "55-64", ""],
      ["65_plus", "65 or above", "65岁及以上"],
    ],
  },
  {
    id: "A3",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A3. Your major category",
    cn: "你的专业类别：",
    required: true,
    multiple: false,
    options: [
      ["stem", "STEM Science / Technology / Engineering / Mathematics", "理工科"],
      ["humanities", "Humanities / Social Sciences", "人文社科"],
      ["business", "Business / Management", "商科/管理"],
      ["other", "Other", "其他", true],
    ],
  },
  {
    id: "A4",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A4. Have you taken or are you currently taking any programming-related courses?",
    cn: "你是否正在修读或曾经修读过编程相关课程？",
    required: true,
    multiple: false,
    options: [
      ["current", "Yes, currently taking", "是，正在修读"],
      ["completed", "Yes, completed", "是，已完成修读"],
      ["A4_no_never", "No, never taken", "否，从未修读过"],
    ],
  },
  {
    id: "A5",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A5. Which programming languages do you know? (Select all that apply)",
    cn: "你了解或使用过哪些编程语言？（可多选）",
    required: true,
    multiple: true,
    exclusiveValues: ["A5_none"],
    options: [
      ["python", "Python", ""],
      ["java", "Java", ""],
      ["c", "C", ""],
      ["cpp", "C++", ""],
      ["csharp", "C#", ""],
      ["js_ts", "JavaScript / TypeScript", ""],
      ["html", "HTML", ""],
      ["css", "CSS", ""],
      ["A5_none", "None", "无"],
      ["other", "Other", "其他", true],
    ],
  },
  {
    id: "A6",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A6. What is your current year of study?",
    cn: "你目前的年级是？",
    required: true,
    multiple: false,
    options: [
      ["undergraduate", "Undergraduate", "本科生"],
      ["graduate", "Graduate", "硕士研究生"],
      ["postgraduate", "Postgraduate", "博士研究生"],
      ["other", "Other", "其他", true],
    ],
  },
  {
    id: "A7",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A7. Which AI tools have you used for programming? (Select all that apply)",
    cn: "你使用过哪些 AI 工具辅助编程？（可多选）",
    required: true,
    multiple: true,
    exclusiveValues: ["A7_never"],
    options: [
      [
        "general_assistant",
        "General-purpose conversational assistant (e.g., AI tools, Gemini, Doubao, DeepSeek, Qwen, ERNIE Bot)",
        "通用对话式 AI 助手",
      ],
      [
        "coding_agent",
        "AI coding agent (e.g., Codex, Copilot, Claude Code, Cursor)",
        "AI 编程智能体",
      ],
      ["A7_never", "Never Used", "未使用过"],
      ["other", "Other", "其他", true],
    ],
  },
  {
    id: "A8",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A8. How long have you been using AI tools for programming?",
    cn: "你使用 AI 工具辅助编程有多长时间了？",
    required: true,
    multiple: false,
    options: [
      ["lt_1_month", "Less than 1 month", "不到 1 个月"],
      ["1_3_months", "1-3 months", "1-3 个月"],
      ["3_6_months", "3-6 months", "3-6 个月"],
      ["6_12_months", "6-12 months", "6-12 个月"],
      ["gt_1_year", "More than 1 year", "超过 1 年"],
      ["A8_never", "Never used", "从未使用"],
    ],
  },
  {
    id: "A9",
    type: "choice",
    topLabel: "Background Information / 背景信息",
    en: "A9. How frequently do you use AI tools for programming?",
    cn: "你多久使用一次 AI 工具进行编程？",
    required: true,
    multiple: false,
    options: [
      ["daily", "Every day", "每天"],
      ["2_6_week", "2-6 times per week", "每周 2-6 次"],
      ["weekly", "Once a week", "每周 1 次"],
      ["2_3_month", "2-3 times per month", "每月 2-3 次"],
      ["monthly", "Once a month", "每月 1 次"],
      ["less_monthly", "Less than once a month", "少于每月 1 次"],
      ["A9_never", "Never Used", "从未使用"],
    ],
  },
  {
    id: "B",
    type: "likert",
    topLabel: "Programming Assignment Experience / 编程作业经历",
    title: "Instructions: Please answer based on your actual experience with programming assignments.",
    titleCn: "说明：请根据你在编程作业中的真实经历回答。",
    leftLabel: "Strongly Disagree / 非常不同意",
    rightLabel: "Strongly Agree / 非常同意",
    items: [
      ["B1", "When programming, even for tasks I can easily complete on my own, I still unconsciously turn to generative AI tools to generate code.", "即使是在我自己能轻松完成的编程任务上，我仍然会不自觉地转向生成式 AI 工具来生成代码。"],
      ["B2", "When encountering programming problems, I first turn to generative AI rather than attempting to think independently or consult documentation.", "当遇到编程问题时，我的第一反应是求助于生成式 AI，而不是尝试独立思考或查阅文档。"],
      ["B3", "When the suggestions provided by one generative AI tool fail to resolve a programming problem immediately, I switch to another generative AI tool to continue programming.", "当一个生成式 AI 工具的建议未能立即解决编程问题时，我会切换到另一个生成式 AI 工具继续编程。"],
      ["B4", "When code generated by a generative AI tool contains errors, I am more inclined to rely on another generative AI tool for debugging rather than analyzing the code line by line myself.", "当 AI 生成的代码包含错误时，我更倾向于依赖另一个生成式 AI 工具来调试，而不是自己逐行分析代码。"],
      ["B5", "My use of generative AI has caused concerns for me.", "我对生成式 AI 的使用已经引起了我的担忧。"],
      ["B6", "I have trouble completing work or other responsibilities without generative AI.", "没有生成式 AI，我难以完成工作或其他任务。"],
      ["B7", "I feel less confident in my abilities without generative AI.", "没有生成式 AI，我对自己的能力感到不那么自信。"],
      ["B8", "My use of generative AI has negatively affected my problem-solving skills or efficiency.", "我对生成式 AI 的使用已经对我的问题解决能力或效率产生了负面影响。"],
    ],
  },
  {
    id: "C1",
    type: "likert",
    topLabel: "AI Tools for Programming Learning / AI 编程学习",
    title: "C1. Perceived Usefulness for Programming Learning",
    titleCn: "编程学习有用性感知",
    leftLabel: "Strongly Disagree / 非常不同意",
    rightLabel: "Strongly Agree / 非常同意",
    explain: ["Please explain the reasons for your ratings above:", "请解释你上述评分的理由："],
    items: [
      ["C1.1", "AI tools help me to learn programming more efficiently.", "AI tools 帮助我更高效地学习编程。"],
      ["C1.2", "AI tools improve my programming performance.", "AI tools 提高了我的编程表现。"],
      ["C1.3", "AI tools make my learning more effective.", "AI tools 让我的学习更有效。"],
      ["C1.4", "AI tools make it easier to learn programming.", "AI tools 让学习编程变得更容易。"],
      ["C1.5", "Overall, AI tools are advantageous for my programming learning.", "总体而言，AI tools 对我的编程学习是有益的。"],
    ],
  },
  {
    id: "C2",
    type: "likert",
    topLabel: "AI Tools for Programming Learning / AI 编程学习",
    title: "C2. Perceived Cost / Responsible AI Risk",
    titleCn: "感知成本与负责任 AI 风险",
    leftLabel: "Strongly Disagree / 非常不同意",
    rightLabel: "Strongly Agree / 非常同意",
    explain: ["Please explain the reasons for your ratings above:", "请解释你上述评分的理由："],
    items: [
      ["C2.1", "Using generative AI technologies such as AI tools to complete assignments undermines the value of a university education.", "使用 AI tools 等生成式 AI 技术完成作业会削弱大学教育的价值。"],
      ["C2.2", "Generative AI technologies such as AI tools will limit my opportunities to interact with others and socialize while completing coursework.", "在完成课程任务时，AI tools 等生成式 AI 技术会限制我与他人互动和社交的机会。"],
      ["C2.3", "Generative AI technologies such as AI tools will hinder my development of generic or transferable skills such as teamwork, problem-solving, and leadership skills.", "AI tools 等生成式 AI 技术会阻碍我发展团队合作、问题解决和领导力等通用或可迁移技能。"],
      ["C2.4", "I can become over-reliant on generative AI technologies.", "我可能会过度依赖生成式 AI 技术。"],
    ],
  },
  {
    id: "C3",
    type: "likert",
    topLabel: "AI Tools for Programming Learning / AI 编程学习",
    title: "C3. Programming Learning Acceptance",
    titleCn: "编程学习接受度",
    leftLabel: "Strongly Disagree / 非常不同意",
    rightLabel: "Strongly Agree / 非常同意",
    explain: ["Please explain the reasons for your ratings above:", "请解释你上述评分的理由："],
    items: [
      ["C3.1", "Are AI tools helpful for learning programming?", "AI tools 对学习编程有帮助吗？"],
      ["C3.2", "Will you keep using AI tools for learning programming?", "你会继续使用 AI tools 学习编程吗？"],
      ["C3.3", "Will you use AI tools often?", "你会经常使用 AI tools 吗？"],
      ["C3.4", "Will you recommend AI tools to friends?", "你会向朋友推荐 AI tools 吗？"],
    ],
  },
  {
    id: "C4",
    type: "likert",
    topLabel: "AI Tools for Programming Learning / AI 编程学习",
    title: "C4. How and to what extent do you think AI tools can help with your programming learning?",
    titleCn: "你认为 AI 工具在多大程度上能帮助你学习编程？",
    leftLabel: "Not useful at all",
    rightLabel: "Extremely useful",
    explain: [
      "Please explain the reasons for your ratings above (e.g., why you rated a particular function as highly useful or not useful):",
      "请解释你上述评分的理由（例如，为什么你认为某个功能特别有用或没有用）：",
    ],
    items: [
      ["C4.1", "Correct programming code", "纠正编程代码"],
      ["C4.2", "Answer programming questions", "回答编程问题"],
      ["C4.3", "Provide examples of programming code", "提供编程代码示例"],
      ["C4.4", "Offer learning advice and resources", "提供学习建议和资源"],
      ["C4.5", "Explain programming concepts", "解释编程概念"],
    ],
  },
  {
    id: "C5",
    type: "text",
    topLabel: "AI Tools for Programming Learning / AI 编程学习",
    title: "C5. Open-Ended Questions",
    titleCn: "开放题",
    en: "How could AI tools be improved to better assist with programming learning?",
    cn: "AI tools 应如何改进，才能更好地辅助编程学习？",
    required: true,
  },
  {
    id: "submit",
    type: "submit",
    topLabel: "Submission / 提交",
  },
];

const state = {
  index: 0,
  respondentId: getOrCreateRespondentId(),
  answers: {},
  completedScreens: [],
  endedEarly: false,
  endReason: "",
  submissionStatus: "idle",
  submissionError: "",
  saveStatus: "idle",
  saveError: "",
};

restoreLocalProgress();

const screenEl = document.querySelector("#screen");
const nextButton = document.querySelector("#nextButton");
const validationMessage = document.querySelector("#validationMessage");
const stepLabel = document.querySelector("#stepLabel");
const progressLabel = document.querySelector("#progressLabel");

nextButton.addEventListener("click", handleNext);

function render() {
  const current = screens[state.index];
  stepLabel.textContent = current.topLabel || "Questionnaire";
  progressLabel.textContent = getProgressLabel(current);
  validationMessage.textContent = "";
  nextButton.hidden = current.type === "submit";
  nextButton.disabled = !isComplete(current);
  if (state.saveStatus === "saving") {
    nextButton.textContent = "Saving...";
  } else {
    nextButton.textContent = current.type === "consent" ? "Agree and Continue" : "Continue";
  }

  if (current.type === "welcome") renderWelcome(current);
  if (current.type === "consent") renderConsent(current);
  if (current.type === "choice") renderChoice(current);
  if (current.type === "likert") renderLikert(current);
  if (current.type === "text") renderText(current);
  if (current.type === "submit") renderSubmit(current);
}

function restoreLocalProgress() {
  const saved = readLocalProgress();
  if (!saved || saved.respondentId !== state.respondentId) return;

  state.answers = saved.answers || {};
  state.completedScreens = saved.completedScreens || [];
  state.endedEarly = saved.endedEarly === true;
  state.endReason = saved.endReason || "";

  const nextIndex = Number.isInteger(saved.nextIndex) ? saved.nextIndex : 0;
  if (nextIndex > 0 && nextIndex < screens.length) {
    state.index = nextIndex;
  }
}

function renderWelcome(screen) {
  screenEl.innerHTML = `
    <h1>${screen.title}<span class="cn-title">${screen.titleCn}</span></h1>
    <p class="intro">${screen.body}<br>${screen.bodyCn}</p>
  `;
}

function renderConsent(screen) {
  const selected = getAnswer(screen.id)?.value || [];
  screenEl.innerHTML = `
    <div class="consent-copy">
      <h2>${screen.title}<span class="cn-title">${screen.titleCn}</span></h2>
      ${screen.paragraphs
        .map(
          ([en, cn]) => `
            <p>
              <span>${en}</span>
              <span>${cn}</span>
            </p>
          `
        )
        .join("")}
    </div>
    <div class="options consent-options">
      ${screen.confirmations
        .map(([value, en, cn]) => {
          const checked = selected.includes(value) ? "checked" : "";
          return `
            <label class="option">
              <input type="checkbox" name="${screen.id}" value="${value}" ${checked}>
              <span class="option-text">
                <span class="en">${en}</span>
                <span class="cn">${cn}</span>
              </span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;

  screenEl.querySelectorAll(`input[name="${screen.id}"]`).forEach((input) => {
    input.addEventListener("change", () => {
      const value = [...screenEl.querySelectorAll(`input[name="${screen.id}"]:checked`)].map(
        (item) => item.value
      );
      state.answers[screen.id] = { value };
      saveLocalProgress();
      nextButton.disabled = !isComplete(screen);
    });
  });
}

function renderChoice(screen) {
  const inputType = screen.multiple ? "checkbox" : "radio";
  const selected = getAnswer(screen.id)?.value || [];
  screenEl.innerHTML = `
    <div class="question-title">
      <span class="en">${screen.en}</span>
      <span class="cn">${screen.cn}</span>
    </div>
    <div class="options">
      ${screen.options
        .map(([value, en, cn, hasOther]) => {
          const checked = selected.includes(value) ? "checked" : "";
          const otherValue = getAnswer(screen.id)?.other?.[value] || "";
          return `
            <label class="option">
              <input type="${inputType}" name="${screen.id}" value="${value}" ${checked}>
              <span class="option-text">
                <span class="en">${en}</span>
                ${cn ? `<span class="cn">${cn}</span>` : ""}
                ${hasOther ? `<span class="other-field"><input data-other="${value}" type="text" value="${escapeAttr(otherValue)}" placeholder="Please specify / 请说明"></span>` : ""}
              </span>
            </label>
          `;
        })
        .join("")}
    </div>
  `;

  screenEl.querySelectorAll(`input[name="${screen.id}"]`).forEach((input) => {
    input.addEventListener("change", () => updateChoice(screen));
  });
  screenEl.querySelectorAll("[data-other]").forEach((input) => {
    input.addEventListener("input", () => {
      const otherOption = screenEl.querySelector(
        `input[name="${screen.id}"][value="${input.dataset.other}"]`
      );
      if (input.value.trim() && otherOption) {
        otherOption.checked = true;
      }
      updateChoice(screen);
    });
  });
}

function updateChoice(screen) {
  let selected = [...screenEl.querySelectorAll(`input[name="${screen.id}"]:checked`)].map(
    (input) => input.value
  );

  if (screen.multiple && screen.exclusiveValues) {
    const latest = document.activeElement?.value;
    if (screen.exclusiveValues.includes(latest)) {
      selected = [latest];
    } else {
      selected = selected.filter((value) => !screen.exclusiveValues.includes(value));
    }
    screenEl.querySelectorAll(`input[name="${screen.id}"]`).forEach((input) => {
      input.checked = selected.includes(input.value);
    });
  }

  const other = {};
  screenEl.querySelectorAll("[data-other]").forEach((input) => {
    if (selected.includes(input.dataset.other)) other[input.dataset.other] = input.value.trim();
  });

  state.answers[screen.id] = { value: selected, other };
  saveLocalProgress();
  nextButton.disabled = !isComplete(screen);
}

function renderLikert(screen) {
  if (isMobileLayout()) {
    renderLikertMobile(screen);
    return;
  }

  const answer = getLikertAnswer(screen.id);
  screenEl.innerHTML = `
    <div class="question-title">
      <span class="en">${screen.title}</span>
      <span class="cn">${screen.titleCn}</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="item-code">Item<br>题号</th>
            <th>Question<br>问题</th>
            <th>Response<br>作答</th>
          </tr>
        </thead>
        <tbody>
          ${screen.items
            .map(
              ([code, en, cn]) => `
                <tr>
                  <td class="item-code">${code}</td>
                  <td class="prompt"><span class="en">${en}</span><span class="cn">${cn}</span></td>
                  <td class="scale" data-code="${code}">
                    <div class="scale-row">
                      ${formatEndpointLabel(screen.leftLabel, "scale-end left")}
                      <div class="scale-buttons">
                        ${[1, 2, 3, 4, 5]
                          .map(
                            (score) =>
                              `<button type="button" data-score="${score}" class="${answer.values[code] === score ? "selected" : ""}">
                                <span class="score-number">${score}</span>
                              </button>`
                          )
                          .join("")}
                      </div>
                      ${formatEndpointLabel(screen.rightLabel, "scale-end right")}
                    </div>
                  </td>
                </tr>
                ${
                  screen.explain
                    ? `<tr class="desktop-explanation-row">
                        <td></td>
                        <td colspan="2">
                          ${renderSingleItemExplanation(code, en, answer, "desktop-item-explanation")}
                        </td>
                      </tr>`
                    : ""
                }
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  screenEl.querySelectorAll(".scale button").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.closest(".scale").dataset.code;
      ensureLikertAnswer(screen.id);
      state.answers[screen.id].values[code] = Number(button.dataset.score);
      saveLocalProgress();
      button.parentElement.querySelectorAll("button").forEach((sibling) => sibling.classList.remove("selected"));
      button.classList.add("selected");
      nextButton.disabled = !isComplete(screen);
    });
  });

  screenEl.querySelectorAll("[data-explanation-code]").forEach((explanation) => {
    explanation.addEventListener("input", () => {
      ensureLikertAnswer(screen.id);
      const code = explanation.dataset.explanationCode;
      state.answers[screen.id].explanations[code] = explanation.value.trim();
      explanation
        .closest(".item-explanation")
        ?.classList.toggle("invalid", explanation.value.trim() !== "" && !isValidExplanation(explanation.value));
      saveLocalProgress();
      nextButton.disabled = !isComplete(screen);
    });
  });
}

function renderLikertMobile(screen) {
  const answer = getLikertAnswer(screen.id);

  screenEl.innerHTML = `
    <div class="question-title mobile-likert-title">
      <span class="en">${screen.title}</span>
      <span class="cn">${screen.titleCn}</span>
      <span class="item-progress">${screen.items.length} items / ${screen.items.length} 题</span>
    </div>
    <div class="mobile-likert-list">
      ${screen.items
        .map(
          ([code, en, cn]) => `
            <section class="mobile-likert-card">
              <p class="mobile-item-code">${code}</p>
              <div class="prompt">
                <span class="en">${en}</span>
                <span class="cn">${cn}</span>
              </div>
              <div class="scale mobile-scale" data-code="${code}">
                <div class="scale-row">
                  ${formatEndpointLabel(screen.leftLabel, "scale-end left")}
                  <div class="scale-buttons">
                    ${[1, 2, 3, 4, 5]
                      .map(
                        (score) =>
                          `<button type="button" data-score="${score}" class="${answer.values[code] === score ? "selected" : ""}">
                            <span class="score-number">${score}</span>
                          </button>`
                      )
                      .join("")}
                  </div>
                  ${formatEndpointLabel(screen.rightLabel, "scale-end right")}
                </div>
              </div>
              ${
                screen.explain
                  ? renderSingleItemExplanation(code, en, answer, "mobile-item-explanation")
                  : ""
              }
            </section>
          `
        )
        .join("")}
    </div>
`;

  screenEl.querySelectorAll(".scale button").forEach((button) => {
    button.addEventListener("click", () => {
      const code = button.closest(".scale").dataset.code;
      ensureLikertAnswer(screen.id);
      state.answers[screen.id].values[code] = Number(button.dataset.score);
      saveLocalProgress();
      button.parentElement.querySelectorAll("button").forEach((sibling) => sibling.classList.remove("selected"));
      button.classList.add("selected");
      nextButton.disabled = !isComplete(screen);
    });
  });

  screenEl.querySelectorAll("[data-explanation-code]").forEach((explanation) => {
    explanation.addEventListener("input", () => {
      ensureLikertAnswer(screen.id);
      const code = explanation.dataset.explanationCode;
      state.answers[screen.id].explanations[code] = explanation.value.trim();
      explanation
        .closest(".item-explanation")
        ?.classList.toggle("invalid", explanation.value.trim() !== "" && !isValidExplanation(explanation.value));
      saveLocalProgress();
      nextButton.disabled = !isComplete(screen);
    });
  });
}

function renderItemExplanations(screen, answer) {
  return `
    <div class="item-explanations">
      <div class="explain-box explanation-intro">
        <label>
          Please explain why you selected each rating above.
          <span class="cn">请分别解释上表中每一道题为什么这样评分。</span>
        </label>
      </div>
      ${screen.items
        .map(([code, en]) => renderSingleItemExplanation(code, en, answer))
        .join("")}
    </div>
  `;
}

function renderSingleItemExplanation(code, en, answer, extraClass = "") {
  const value = getItemExplanation(answer, code);
  const invalidClass = value && !isValidExplanation(value) ? " invalid" : "";
  return `
    <div class="explain-box item-explanation ${extraClass}${invalidClass}">
      <textarea
        aria-label="Explanation for this rating"
        data-explanation-code="${code}"
        placeholder="Please explain your rating thoughtfully. Avoid writing only 'none', 'no', or 'I do not know'. / \u8bf7\u8ba4\u771f\u8bf4\u660e\u8bc4\u5206\u7406\u7531\uff0c\u907f\u514d\u53ea\u5199\u201c\u65e0 / \u6ca1\u6709 / \u4e0d\u77e5\u9053\u201d\u3002"
      >${escapeHtml(value)}</textarea>
      <p class="explanation-warning">Please write a brief and specific reason for this rating. / \u8bf7\u586b\u5199\u7b80\u77ed\u4e14\u5177\u4f53\u7684\u8bc4\u5206\u7406\u7531\u3002</p>
    </div>
  `;
}
function getLikertAnswer(screenId) {
  const answer = state.answers[screenId] || {};
  return {
    ...answer,
    values: answer.values || {},
    explanations: answer.explanations || {},
  };
}

function ensureLikertAnswer(screenId) {
  if (!state.answers[screenId]) state.answers[screenId] = { values: {}, explanations: {} };
  if (!state.answers[screenId].values) state.answers[screenId].values = {};
  if (!state.answers[screenId].explanations) state.answers[screenId].explanations = {};
}

function getItemExplanation(answer, code) {
  return answer.explanations?.[code] || "";
}

function isValidExplanation(value) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const normalized = trimmed
    .toLowerCase()
    .replace(/[\s.,，。!！?？、/\\\-_'"]/g, "");
  if (INVALID_EXPLANATIONS.has(normalized)) return false;
  return normalized.length >= 2;
}

function renderText(screen) {
  const answer = getAnswer(screen.id)?.value || "";
  screenEl.innerHTML = `
    <div class="question-title">
      <span class="en">${screen.title}</span>
      <span class="cn">${screen.titleCn}</span>
    </div>
    <div class="explain-box">
      <label>${screen.en}<span class="cn">${screen.cn}</span></label>
      <textarea id="textAnswer" placeholder="Type your answer here / 请在此输入答案">${answer}</textarea>
    </div>
  `;
  screenEl.querySelector("#textAnswer").addEventListener("input", (event) => {
    state.answers[screen.id] = { value: event.target.value.trim() };
    saveLocalProgress();
    nextButton.disabled = !isComplete(screen);
  });
}

function renderSubmit() {
  const payload = buildSubmissionPayload();
  localStorage.setItem("questionnaireResponses", JSON.stringify(payload));
  const early = state.endedEarly
    ? `<p><strong>Questionnaire ended early.</strong><br>结束原因：${state.endReason}</p>`
    : "<p><strong>All pages are complete.</strong><br>所有页面均已完成。</p>";
  const submitStatus = getSubmissionStatusMessage();

  screenEl.innerHTML = `
    <p class="kicker">Submission</p>
    <h2>Thank you<span class="cn-title">感谢你的填写</span></h2>
    <div class="status">
      ${early}
      ${submitStatus}
    </div>
  `;
}

async function handleNext() {
  const current = screens[state.index];

  if (!isComplete(current)) {
    validationMessage.textContent = "Please complete this page before continuing. / 请先完成当前页面。";
    return;
  }

  const trigger = getEndTrigger(current);
  if (trigger) {
    state.endedEarly = true;
    state.endReason = trigger;
    const submitIndex = screens.findIndex((screen) => screen.id === "submit");
    saveLocalProgress(submitIndex);
    const saved = await saveProgress(current.id, true);
    if (!saved) {
      render();
      validationMessage.textContent = "Save failed. Please check your connection and try again. / 保存失败，请检查网络后重试。";
      return;
    }
    state.index = submitIndex;
    render();
    return;
  }

  saveLocalProgress(state.index + 1);
  const saved = await saveProgress(current.id, current.id === "C5");
  if (!saved) {
    render();
    validationMessage.textContent = "Save failed. Please check your connection and try again. / 保存失败，请检查网络后重试。";
    return;
  }
  state.index += 1;
  saveLocalProgress(state.index);
  render();
}

function getAnswer(id) {
  return state.answers[id];
}

function isComplete(screen) {
  if (screen.type === "welcome" || screen.type === "submit") return true;
  const answer = getAnswer(screen.id);
  if (screen.type === "consent") {
    return screen.confirmations.every(([value]) => answer?.value?.includes(value));
  }
  if (screen.type === "choice") {
    if (!answer || answer.value.length === 0) return false;
    const selectedOther = screen.options.filter((option) => option[3]).map((option) => option[0]);
    return selectedOther.every((value) => !answer.value.includes(value) || Boolean(answer.other?.[value]));
  }
  if (screen.type === "likert") {
    if (!answer) return false;
    const allRated = screen.items.every(([code]) => Number.isInteger(answer.values?.[code]));
    const explanationReady =
      !screen.explain ||
      screen.items.every(([code]) => isValidExplanation(answer.explanations?.[code] || ""));
    return allRated && explanationReady;
  }
  if (screen.type === "text") return Boolean(answer?.value?.trim());
  return false;
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 760px)").matches;
}

function getProgressLabel(screen) {
  const base = `${Math.min(state.index + 1, screens.length)}/${screens.length}`;
  return base;
}

function getEndTrigger(screen) {
  if (screen.type !== "choice") return "";
  const selected = getAnswer(screen.id)?.value || [];
  return selected.find((value) => END_TRIGGERS.has(value)) || "";
}

function buildSubmissionPayload() {
  return {
    respondentId: state.respondentId,
    submittedAt: new Date().toISOString(),
    endedEarly: state.endedEarly,
    endReason: state.endReason,
    currentScreenId: screens[state.index]?.id || "",
    completedScreens: state.completedScreens,
    answers: state.answers,
  };
}

async function saveProgress(screenId, isFinal = false) {
  rememberCompletedScreen(screenId);
  const payload = {
    ...buildSubmissionPayload(),
    lastCompletedScreenId: screenId,
    isFinal,
  };
  localStorage.setItem("questionnaireResponses", JSON.stringify(payload));
  saveLocalProgress();

  if (!SUBMISSION_ENDPOINT) return true;

  state.saveStatus = "saving";
  state.saveError = "";
  nextButton.disabled = true;
  nextButton.textContent = "Saving...";

  try {
    await submitResponses(payload);
    state.saveStatus = "saved";
    return true;
  } catch (error) {
    state.saveStatus = "error";
    state.saveError = error.message || "Save failed";
    return false;
  }
}

function saveLocalProgress(nextIndex = state.index) {
  const progress = {
    respondentId: state.respondentId,
    nextIndex,
    answers: state.answers,
    completedScreens: state.completedScreens,
    endedEarly: state.endedEarly,
    endReason: state.endReason,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(LOCAL_PROGRESS_KEY, JSON.stringify(progress));
}

function readLocalProgress() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PROGRESS_KEY) || "null");
  } catch {
    return null;
  }
}

function rememberCompletedScreen(screenId) {
  if (!screenId || screenId === "welcome" || screenId === "submit") return;
  if (!state.completedScreens.includes(screenId)) {
    state.completedScreens.push(screenId);
  }
}

function submitResponses(payload) {
  return fetch(SUBMISSION_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
}

function getSubmissionStatusMessage() {
  if (state.saveStatus === "saved") {
    return `
      <p><strong>Response submitted.</strong><br>问卷数据已提交。</p>
    `;
  }
  if (state.saveStatus === "error") {
    return `
      <p><strong>Response could not be submitted.</strong><br>问卷数据提交失败：${escapeHtml(state.saveError)}</p>
      <p>Please contact the researcher. / 请联系研究人员。</p>
    `;
  }
  return `
    <p><strong>Response completed.</strong><br>问卷已完成。</p>
    <p>Your response has been saved to the research database.</p>
    <p>问卷数据已保存到研究数据库。</p>
  `;
}

function getOrCreateRespondentId() {
  const key = "questionnaireRespondentId";
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const generated =
    window.crypto?.randomUUID?.() ||
    `respondent-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, generated);
  return generated;
}

function escapeAttr(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtml(value) {
  return escapeAttr(value);
}

function formatEndpointLabel(label, className = "endpoint-label") {
  const [en, cn] = String(label).split(" / ");
  return `
    <span class="${className}">
      <span>${en || ""}</span>
      ${cn ? `<span>${cn}</span>` : ""}
    </span>
  `;
}

render();
