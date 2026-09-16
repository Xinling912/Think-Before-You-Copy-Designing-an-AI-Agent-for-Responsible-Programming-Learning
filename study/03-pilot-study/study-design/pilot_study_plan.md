# Pilot Study Plan for ResponsibleEduAgent

## Purpose

This pilot study aims to preliminarily examine whether ResponsibleEduAgent can support Python programming learning in a responsible way. Instead of testing whether the agent improves programming performance in a strict experimental sense, the study focuses on whether students can perceive and use the agent's key design goals: guided tutoring, evidence-grounded explanations, interactive debugging support, and context-aware learning assistance.

## Overall Structure

Estimated duration: 15-18 minutes per participant.

1. Consent form: about 1 minute
2. Short demographic questions: about 2 minutes
3. Main task 1: concept understanding with visual evidence, about 4-5 minutes
4. Main task 2: debugging support without code writing, about 5-6 minutes
5. Post-questionnaire: about 4-5 minutes

## Consent Form

The consent form should follow the same structure as the formative questionnaire consent form, but the study purpose should be updated for the pilot study.

Suggested description:

> This study aims to preliminarily evaluate the user experience of ResponsibleEduAgent, an AI tutoring system designed to support Python programming learning through guided help, visual learning evidence, and responsible AI assistance.

The consent form should clearly state:

- Participation is voluntary.
- Participants may withdraw at any time without negative consequences.
- The study does not evaluate participants' programming ability.
- Data will be used only for research purposes.
- No real names are collected.
- The study may collect task responses, questionnaire answers, and open-ended feedback about the system.

## Short Demographic Questions

The demographic section should be shorter than the formative questionnaire. It only needs to collect variables useful for interpreting the pilot study.

Recommended items:

1. Age range
2. Major or field of study
3. Current study level
4. Python familiarity, 1-5 scale
5. Programming experience
   - Never
   - Less than 6 months
   - 6-12 months
   - More than 1 year
6. Frequency of using AI tools for programming
   - Never
   - Monthly
   - Weekly
   - Daily
7. Previous experience with AI coding agents
   - Yes
   - No

If the survey needs to be shorter, keep only major, study level, Python familiarity, and AI programming frequency.

## Main Task 1: Concept Understanding with Visual Evidence

### Goal

This task evaluates whether participants can use ResponsibleEduAgent to understand a Python concept and whether visual learning evidence helps them locate the concept within the knowledge structure.

### Related Design Goals

- G1 Learner Autonomy and Guided Tutoring
- G2 Evidence-Grounded Responsible AI Assistance
- G3 Interactive Programming Tutoring and Support
- G5 Context-Aware AI Improvement and Integration

### Scenario

Participants are told:

> You are learning Python loops and lists. You are confused about why Python list indexing starts from 0 and how a `for` loop visits each item in a list.

### Participant Task

Participants should:

1. Ask ResponsibleEduAgent for help with this concept.
2. Use the agent's explanation, knowledge path, or visual evidence.
3. Answer a simple comprehension question.

### Example Comprehension Question

After using the agent, which explanation best describes what `for item in list` does?

A. It changes every item in the list automatically.  
B. It visits each element in the list one by one.  
C. It only works for numbers.  
D. It deletes the list after the loop.

Expected answer: B.

### Why This Task Works

This task does not require participants to write code. It tests whether the agent supports conceptual understanding, provides learning evidence, and encourages guided learning rather than direct answer delivery.

## Main Task 2: Debugging Without Writing Code

### Goal

This task evaluates whether participants can use ResponsibleEduAgent to understand a programming error through step-by-step diagnosis, without requiring the system to validate user-written code.

### Related Design Goals

- G1 Learner Autonomy and Guided Tutoring
- G2 Evidence-Grounded Responsible AI Assistance
- G3 Interactive Programming Tutoring and Support
- G4 Personalized Learner Growth and Collaboration, partially observed through weakness identification
- G5 Context-Aware AI Improvement and Integration

### Scenario

Participants are shown the following code and error:

```python
numbers = [1, 2, 3]
print(numbers[3])
```

```text
IndexError: list index out of range
```

### Participant Task

Participants should:

1. Ask ResponsibleEduAgent what is wrong.
2. Follow the agent's diagnostic prompts or hints.
3. Choose the best explanation or fix from multiple-choice options.
4. Write one sentence explaining why the error happened.

### Example Multiple-Choice Question

What caused the error?

A. Python lists cannot store numbers.  
B. The index 3 is outside the valid range; the last valid index is 2.  
C. The `print` function cannot print list elements.  
D. The variable name `numbers` is invalid.

Expected answer: B.

### Short Explanation Prompt

In one sentence, explain why the error happened.

### Why This Task Works

The task lets participants experience debugging support without asking them to write or submit a full code solution. It is easier to implement in a questionnaire because the main outcome can be captured through multiple-choice selection and short explanation.

## Post-Questionnaire

Use a five-point Likert scale:

1 = Strongly disagree  
5 = Strongly agree

### Closed Questions

1. The agent guided me to think before giving a final answer.
   - Related goal: G1

2. The agent helped me understand the programming concept rather than only giving an answer.
   - Related goals: G1, G3

3. The visual learning evidence helped me see where the question fits in the Python knowledge structure.
   - Related goal: G2

4. The agent's explanation made it easier to judge whether the answer was reliable.
   - Related goal: G2

5. The agent helped me diagnose the programming error step by step.
   - Related goal: G3

6. The agent made me less likely to simply copy an answer without understanding it.
   - Related goals: G1, responsible use

7. I would consider using this agent when learning Python in the future.
   - Overall acceptance

### Open Questions

1. What did the agent do well in supporting your programming learning? Why?

2. What should be improved to better support responsible AI-assisted programming learning?

Optional alternative:

> Did any part of the agent make you confused, less confident, or less willing to use it? Please explain.

## Recommended Positioning in the Paper

The pilot study should be framed as a preliminary exploration rather than a controlled effectiveness study.

Suggested wording:

> We conducted a preliminary pilot study to examine whether the implemented design goals of ResponsibleEduAgent were understandable and useful to students in realistic Python-learning scenarios.

This framing is safer than claiming that the agent significantly improves programming performance.

## Notes for Implementation

- Avoid tasks requiring participants to write full programs.
- Prefer multiple-choice, short explanation, and interaction-based tasks.
- If the current prototype cannot fully support one of the planned interactions, the task can be adjusted to a guided scenario evaluation: participants interact with or view a demonstration of the feature, then answer the same post-questionnaire items.
- The two main tasks should be simple enough for participants with beginner-level Python knowledge.
- The task materials should align with the implemented features rather than future features that are only discussed in the limitations section.

