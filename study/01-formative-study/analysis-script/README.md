# Reproducing the Formative Study Analysis

This folder contains one analysis script:
`reproduce_formative_analysis.py`.

## Input

By default, the script expects the OSF archive layout:

```text
../Original Data/formative_responses_complete_40.csv
```

This file contains the 40 complete, deidentified questionnaire records analyzed
in the study. Because it also contains open-text responses, it is retained in
the private OSF archive and is not included in public GitHub. After obtaining
authorized access, either recreate the expected `Original Data` directory or
pass the file explicitly with `--input`.

## Setup

Python 3.10 or later is recommended.

```powershell
python -m pip install -r requirements.txt
```

## Run

From this folder:

```powershell
python reproduce_formative_analysis.py --input "path/to/formative_responses_complete_40.csv"
```

To choose another output folder:

```powershell
python reproduce_formative_analysis.py --output-dir path/to/output
```

## Outputs

The script creates `reproduced_output` containing:

- `BC_rating_frequency_counts_combined.csv`: item-level B/C means, standard
  deviations, and rating 1-5 counts and proportions.
- `BC_dimension_rating_counts_combined.csv`: pooled statistics for the
  dimensions shown in the paper figures.
- `formative_analysis_tables.xlsx`: the B/C item- and dimension-level results
  organized as workbook sheets.
- `B_likert_dimension_results.pdf`: the Part B dimension-level Likert figure.
- `C_likert_dimension_results.pdf`: the Part C dimension/item-level Likert
  figure.

The script checks that the input contains exactly 40 records and that every
expected B and C Likert item has 40 valid ratings before producing results.

## Analysis structure

- Part B: B1-B4 are pooled as dependency behaviors; B5-B8 are pooled as
  perceived negative consequences.
- Part C: C1 is pooled as perceived usefulness and C2 as responsible risks.
  C3.1-C3.4 and C4.1-C4.5 are reported separately because they represent
  distinct intentions and support functions.

The detailed thematic-analysis workbook in the private OSF archive documents
the qualitative coding and theme-development process. Public GitHub includes a
theme-level summary without quotations or participant labels.
