# Pilot Study Analysis

This workflow reproduces the quantitative summary, qualitative coding tables,
compact Likert PDF, and formatted Excel workbook for the six-participant
EviAgent pilot study.

## Inputs

- `../data/pilotStudyResponses.csv`
- The CSV can be regenerated from the CloudBase JSON export with
  `pilot_json_to_csv.py`.

## Analysis rules

- The two whole-agent questions are pooled across Task 1 and Task 2 as 12
  task-level ratings from six participants.
- The two knowledge-graph questions are pooled in the same way.
- Task-specific summaries remain in `Task Detail` for checking whether the two
  scenarios differ.
- P1--P5 remain separate because they assess G1, G2, G3, interaction clarity,
  and future-use intention.
- The two PDFs keep the original response semantics separate: task ratings
  use helpfulness anchors, while P1--P5 use agreement anchors. Both retain the
  diverging center line, negative/positive percentages, and complete 1--5
  legends.
- Ratings are reported with response counts, medians, and ranges; no
  inferential tests are performed.
- One participant response to one prompt is the qualitative unit of analysis.
  The 36 written responses are coded using G1--G3/usability concepts and
  emergent issues. A participant is counted once per theme.

## Run

From the `pilotStudy/scripts` directory:

```powershell
python analyze_pilot_study.py
node build_pilot_analysis_workbook.mjs
```

The Node step requires `@oai/artifact-tool` to be available as described by
the Codex workspace runtime.

## Main outputs

- `../analysis_outputs/pilot_task_helpfulness.pdf`
- `../analysis_outputs/pilot_poststudy_agreement.pdf`
- `../analysis_outputs/pilot_analysis.xlsx`
- `../analysis_outputs/pilot_rating_summary.csv`
- `../analysis_outputs/qualitative_coding.csv`
- `../analysis_outputs/theme_summary.csv`

The Excel workbook also preserves raw data, task-specific ratings, participant
characteristics, the complete coding table, and the analysis definitions.
