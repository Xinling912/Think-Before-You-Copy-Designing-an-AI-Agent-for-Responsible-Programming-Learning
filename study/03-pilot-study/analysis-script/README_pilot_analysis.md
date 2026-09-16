# Pilot Study Analysis

This workflow reproduces the quantitative summary, qualitative coding tables,
compact Likert PDF, and formatted Excel workbook for the six-participant
EviAgent pilot study.

## Inputs

- `../data/pilotStudyResponses.csv` in the authorized research workspace
- The participant-level CSV is retained in the private OSF archive and is not
  included in public GitHub because the pilot sample is small.

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

From this directory, after providing the authorized input file:

```powershell
python analyze_pilot_study.py "path/to/pilotStudyResponses.csv" "reproduced_output"
```

The public repository includes the Python analysis workflow used to generate
the aggregate outputs. Local workbook-formatting utilities are not required to
review the published evidence.

## Main outputs

- `reproduced_output/pilot_task_helpfulness.pdf`
- `reproduced_output/pilot_poststudy_agreement.pdf`
- `reproduced_output/pilot_rating_summary.csv`
- `reproduced_output/theme_summary.csv`

Participant-level task ratings, characteristics, and the complete coding table
remain in the controlled research archive.
