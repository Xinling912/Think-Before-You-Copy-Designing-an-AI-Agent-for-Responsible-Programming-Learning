# MVP Student-Facing Pedagogical Skills

MVP 启用 5 个学生面对面的 pedagogical skill。这 5 个 skill 不是装饰性提示词，而是 Agent 工作流中的教学约束。

## 1. retrieve-first-gate

学生在获得解释前必须先给出自己的初步理解、猜测或回忆。

记录字段：

- `student_attempt_required: true`
- `cognitive_gate: retrieval`
- `attempt_text`

## 2. progressive-hint-ladder

Agent 按提示等级逐步提供帮助，不直接给最终答案。

提示等级：

1. 概念方向提示；
2. 类比提示；
3. 原则提醒；
4. 操作提示；
5. 平行示例。

记录字段：

- `hint_level_reached`
- `ai_support_type`
- `direct_answer_given`

## 3. stuck-and-error-diagnosis-coach

调试前要求学生指出自己卡在哪里、哪一行出错、属于什么类型的问题。

记录字段：

- `error_location_attempt`
- `student_error_diagnosis`
- `error_type`

## 4. confidence-calibration-check

记录学生在尝试前和反馈后的信心变化。

记录字段：

- `confidence_before`
- `confidence_after`
- `calibration_delta`

## 5. teach-back-evaluator

学生修正问题后，必须用自己的话解释错误原因和修正逻辑。

记录字段：

- `teach_back_text`
- `teach_back_passed`
- `remaining_misconception`

## Skill 存储上限

系统总 skill 上限为 30 个：

- 核心 skill 固定保留；
- 个性化 skill 使用 LRU + 成功率淘汰；
- 临时 skill 使用 TTL / LRU 淘汰。

