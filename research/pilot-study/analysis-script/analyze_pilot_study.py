#!/usr/bin/env python3
"""Reproduce the EviAgent pilot-study summaries, coding tables, and PDFs."""

from __future__ import annotations

import argparse
import json
import math
import subprocess
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.lib import colors
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "pilotStudyResponses.csv"
DEFAULT_OUTPUT = ROOT / "analysis_outputs"
FONT_PATHS = [
    Path(r"C:\Windows\Fonts\arial.ttf"),
    Path(r"C:\Windows\Fonts\msyh.ttc"),
]

TASK_DETAIL = [
    ("T1_agent_rating", "Task 1 - Entire agent"),
    ("T1_knowledge_graph_rating", "Task 1 - Knowledge graph"),
    ("T2_agent_rating", "Task 2 - Entire agent"),
    ("T2_knowledge_graph_rating", "Task 2 - Knowledge graph"),
]

PRIMARY_ITEMS = [
    ("agent_pooled", "Entire agent helpfulness", "12 task-level ratings"),
    ("kg_pooled", "Knowledge graph helpfulness", "12 task-level ratings"),
    ("P1", "G1: Guided tutoring", "6 participants"),
    ("P2", "G2: Reliability judgment", "6 participants"),
    ("P3", "G3: Programming understanding", "6 participants"),
    ("P4", "Interaction clarity", "6 participants"),
    ("P5", "Future use intention", "6 participants"),
]

THEMES = {
    "Clear conceptual explanation and debugging support": {
        "Clear explanations",
        "Concrete examples",
        "Conceptual understanding",
        "Accurate debugging",
        "Principle explanation",
        "Transferable understanding",
        "Problem resolution",
    },
    "Knowledge organization and evidence navigation": {
        "Knowledge organization",
        "Concept relationships",
        "Learning path",
        "Knowledge-gap identification",
        "Knowledge expansion",
        "Traceable official sources",
    },
    "Guided and adaptive tutoring": {
        "Guided learning",
        "Progressive scaffolding",
        "Adaptive support",
        "Confidence calibration",
    },
    "Interaction and localization friction": {
        "Language mismatch",
        "Rigid dialogue",
        "Unnecessary continuation",
        "Excessive steps",
        "Limited initial detail",
        "Insufficient specificity",
        "Intent misunderstanding",
        "Discoverability issue",
        "Need reading guidance",
        "Awkward confidence prompt",
        "Visual navigation issue",
        "Task-context sensitivity",
    },
    "Practice and personalization requests": {
        "Practice generation",
        "Weakness-targeted support",
    },
}

# Manual coding of all 36 written responses after reading each response in context.
MANUAL_CODES = {
    ("P1", "T1_agent_explanation"): ["Clear explanations", "Concrete examples", "Conceptual understanding"],
    ("P1", "T1_knowledge_graph_explanation"): ["Knowledge organization", "Concept relationships", "Learning path"],
    ("P1", "T2_agent_explanation"): ["Accurate debugging"],
    ("P1", "T2_knowledge_graph_explanation"): ["Knowledge-gap identification", "Concept relationships"],
    ("P1", "O1"): ["Clear explanations", "Adaptive support", "Guided learning", "Knowledge organization"],
    ("P1", "O2"): ["Practice generation", "Weakness-targeted support"],
    ("P2", "T1_agent_explanation"): ["Clear explanations", "Language mismatch"],
    ("P2", "T1_knowledge_graph_explanation"): ["Knowledge organization", "Knowledge expansion"],
    ("P2", "T2_agent_explanation"): ["Accurate debugging", "Unnecessary continuation"],
    ("P2", "T2_knowledge_graph_explanation"): ["Knowledge expansion", "Concept relationships"],
    ("P2", "O1"): ["Knowledge expansion"],
    ("P2", "O2"): ["Language mismatch"],
    ("P3", "T1_agent_explanation"): ["Clear explanations", "Insufficient specificity"],
    ("P3", "T1_knowledge_graph_explanation"): ["Knowledge organization", "Concept relationships", "Learning path"],
    ("P3", "T2_agent_explanation"): ["Clear explanations", "Conceptual understanding"],
    ("P3", "T2_knowledge_graph_explanation"): ["Concept relationships", "Learning path"],
    ("P3", "O1"): ["Principle explanation", "Conceptual understanding"],
    ("P3", "O2"): ["Intent misunderstanding"],
    ("P4", "T1_agent_explanation"): ["Principle explanation", "Transferable understanding"],
    ("P4", "T1_knowledge_graph_explanation"): ["Knowledge organization", "Learning path"],
    ("P4", "T2_agent_explanation"): ["Adaptive support", "Confidence calibration"],
    ("P4", "T2_knowledge_graph_explanation"): ["Knowledge-gap identification", "Learning path"],
    ("P4", "O1"): ["Problem resolution", "Accurate debugging"],
    ("P4", "O2"): ["Language mismatch"],
    ("P5", "T1_agent_explanation"): ["Concrete examples", "Conceptual understanding", "Rigid dialogue"],
    ("P5", "T1_knowledge_graph_explanation"): ["Knowledge organization", "Traceable official sources"],
    ("P5", "T2_agent_explanation"): ["Guided learning", "Concrete examples"],
    ("P5", "T2_knowledge_graph_explanation"): ["Knowledge organization", "Knowledge expansion"],
    ("P5", "O1"): ["Conceptual understanding", "Progressive scaffolding"],
    ("P5", "O2"): ["Language mismatch"],
    ("P6", "T1_agent_explanation"): ["Clear explanations", "Limited initial detail"],
    ("P6", "T1_knowledge_graph_explanation"): ["Knowledge organization", "Discoverability issue"],
    ("P6", "T2_agent_explanation"): ["Guided learning", "Excessive steps"],
    ("P6", "T2_knowledge_graph_explanation"): ["Concept relationships", "Need reading guidance"],
    ("P6", "O1"): ["Knowledge organization", "Guided learning", "Traceable official sources", "Task-context sensitivity"],
    ("P6", "O2"): ["Awkward confidence prompt", "Need reading guidance", "Visual navigation issue"],
}

REPRESENTATIVE_QUOTES = {
    "Clear conceptual explanation and debugging support": (
        "P3",
        "The agent not only identified my problem, but also explained the underlying principle so I could understand how to improve.",
    ),
    "Knowledge organization and evidence navigation": (
        "P1",
        "The knowledge graph links related concepts and helps learners quickly build a clear knowledge framework.",
    ),
    "Guided and adaptive tutoring": (
        "P5",
        "The agent used concrete examples to guide me step by step instead of presenting only abstract concepts.",
    ),
    "Interaction and localization friction": (
        "P2",
        "The explanation was clear, but it replied in English in a Chinese-language context.",
    ),
    "Practice and personalization requests": (
        "P1",
        "I hope it can generate coding tasks based on my errors and weaknesses so that I can practise and consolidate the concepts.",
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_csv", nargs="?", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("output_dir", nargs="?", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def validate_data(df: pd.DataFrame) -> None:
    required = [column for column, _ in TASK_DETAIL] + ["P1", "P2", "P3", "P4", "P5", "O1", "O2"]
    missing = [column for column in required if column not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")
    if len(df) != 6 or df["respondentId"].nunique() != 6:
        raise ValueError("Expected six unique pilot participants.")
    rating_columns = [column for column, _ in TASK_DETAIL] + [f"P{i}" for i in range(1, 6)]
    numeric = df[rating_columns].apply(pd.to_numeric, errors="coerce")
    if numeric.isna().any().any() or not numeric.isin(range(1, 6)).all().all():
        raise ValueError("Ratings must be complete integers from 1 to 5.")


def summarize(values: pd.Series, item: str, unit: str) -> dict[str, object]:
    scores = pd.to_numeric(values, errors="raise").astype(int)
    counts = scores.value_counts().to_dict()
    row: dict[str, object] = {
        "Item": item,
        "Unit": unit,
        "N": int(len(scores)),
        "Median": float(scores.median()),
        "Min": int(scores.min()),
        "Max": int(scores.max()),
    }
    for score in range(1, 6):
        row[f"Rating_{score}_count"] = int(counts.get(score, 0))
        row[f"Rating_{score}_pct"] = float(counts.get(score, 0) / len(scores))
    row["Positive_count"] = int((scores >= 4).sum())
    row["Positive_pct"] = float((scores >= 4).mean())
    return row


def build_rating_tables(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    detail_rows = [summarize(df[column], label, "6 participants") for column, label in TASK_DETAIL]
    detail = pd.DataFrame(detail_rows)

    pooled = {
        "agent_pooled": pd.concat([df["T1_agent_rating"], df["T2_agent_rating"]], ignore_index=True),
        "kg_pooled": pd.concat(
            [df["T1_knowledge_graph_rating"], df["T2_knowledge_graph_rating"]], ignore_index=True
        ),
    }
    primary_rows = []
    for key, label, unit in PRIMARY_ITEMS:
        values = pooled[key] if key in pooled else df[key]
        primary_rows.append(summarize(values, label, unit))
    return pd.DataFrame(primary_rows), detail


def build_task_pairs(df: pd.DataFrame) -> pd.DataFrame:
    ordered = df.sort_values("submittedAt").reset_index(drop=True)
    rows = []
    for index, row in ordered.iterrows():
        participant = f"P{index + 1}"
        rows.append(
            {
                "Participant": participant,
                "T1_Agent": int(row["T1_agent_rating"]),
                "T2_Agent": int(row["T2_agent_rating"]),
                "Agent_Difference_T2_minus_T1": int(row["T2_agent_rating"] - row["T1_agent_rating"]),
                "T1_Knowledge_Graph": int(row["T1_knowledge_graph_rating"]),
                "T2_Knowledge_Graph": int(row["T2_knowledge_graph_rating"]),
                "KG_Difference_T2_minus_T1": int(
                    row["T2_knowledge_graph_rating"] - row["T1_knowledge_graph_rating"]
                ),
            }
        )
    return pd.DataFrame(rows)


def build_demographics(df: pd.DataFrame) -> pd.DataFrame:
    labels = {
        "D1": "Age range",
        "D2": "Field of study",
        "D3": "Study level",
        "D4": "Python familiarity",
        "D5": "Programming experience",
        "D6": "Generative AI use for programming",
        "D7": "Prior AI coding-agent use",
    }
    rows = []
    for column, variable in labels.items():
        counts = df[column].astype(str).value_counts(dropna=False)
        for category, count in counts.items():
            rows.append({"Variable": variable, "Category": category, "Count": int(count), "Total": len(df)})
    return pd.DataFrame(rows)


def themes_for_codes(codes: list[str]) -> list[str]:
    return [theme for theme, members in THEMES.items() if any(code in members for code in codes)]


def build_qualitative_tables(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    ordered = df.sort_values("submittedAt").reset_index(drop=True).copy()
    ordered.insert(0, "Participant", [f"P{i}" for i in range(1, len(ordered) + 1)])
    response_columns = [
        "T1_agent_explanation",
        "T1_knowledge_graph_explanation",
        "T2_agent_explanation",
        "T2_knowledge_graph_explanation",
        "O1",
        "O2",
    ]
    coding_rows = []
    theme_participants: defaultdict[str, set[str]] = defaultdict(set)
    theme_code_counts: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for _, row in ordered.iterrows():
        participant = row["Participant"]
        for prompt in response_columns:
            codes = MANUAL_CODES[(participant, prompt)]
            themes = themes_for_codes(codes)
            coding_rows.append(
                {
                    "Participant": participant,
                    "Respondent_ID": row["respondentId"],
                    "Prompt": prompt,
                    "Raw_Response": str(row[prompt]).strip(),
                    "Codes": "; ".join(codes),
                    "Themes": "; ".join(themes),
                    "Status": "Included",
                }
            )
            for theme in themes:
                theme_participants[theme].add(participant)
                theme_code_counts[theme].update(code for code in codes if code in THEMES[theme])

    theme_rows = []
    for theme in THEMES:
        participant, quote = REPRESENTATIVE_QUOTES[theme]
        common_codes = [code for code, _ in theme_code_counts[theme].most_common(3)]
        participants = sorted(theme_participants[theme], key=lambda value: int(value[1:]))
        theme_rows.append(
            {
                "Theme": theme,
                "Representative_Codes": "; ".join(common_codes),
                "Participant_Count": len(participants),
                "Participants": ", ".join(participants),
                "Representative_Quote_EN": quote,
                "Quote_Participant": participant,
            }
        )

    participant_columns = [
        "Participant",
        "respondentId",
        "D1",
        "D2",
        "D3",
        "D4",
        "D5",
        "D6",
        "D7",
    ]
    return pd.DataFrame(coding_rows), pd.DataFrame(theme_rows), ordered[participant_columns]


def register_font() -> str:
    for path in FONT_PATHS:
        if path.exists():
            name = "PilotChartFont"
            pdfmetrics.registerFont(TTFont(name, str(path)))
            return name
    return "Helvetica"


def legend_item_layout(
    width: float,
    font: str,
    font_size: float,
    left_anchor: str,
    right_anchor: str,
) -> list[tuple[int, str, float]]:
    items = [
        (1, f"1 = {left_anchor}"),
        (2, "2"),
        (3, "3"),
        (4, "4"),
        (5, f"5 = {right_anchor}"),
    ]
    boundary = 0.12 * cm
    dot_radius = 0.065 * cm
    label_offset = 0.18 * cm
    text_widths = [pdfmetrics.stringWidth(label, font, font_size) for _, label in items]
    item_widths = [dot_radius + label_offset + text_width for text_width in text_widths]
    first_center = boundary + item_widths[0] / 2
    last_center = width - boundary - item_widths[-1] / 2
    center_step = (last_center - first_center) / (len(items) - 1)
    centers = [first_center + index * center_step for index in range(len(items))]
    positions = [
        center - item_width / 2 + dot_radius
        for center, item_width in zip(centers, item_widths)
    ]
    return [(score, label, position) for (score, label), position in zip(items, positions)]


def draw_rating_pdf(
    summary: pd.DataFrame,
    output: Path,
    left_anchor: str,
    right_anchor: str,
) -> None:
    font = register_font()
    width = 8.0 * cm
    height = (1.72 + max(0, len(summary) - 2) * 0.38) * cm
    c = canvas.Canvas(str(output), pagesize=(width, height))
    palette = {
        1: colors.HexColor("#E8708D"),
        2: colors.HexColor("#F2A5B6"),
        3: colors.HexColor("#D9D9D9"),
        4: colors.HexColor("#96A8E8"),
        5: colors.HexColor("#3F55B7"),
    }
    label_x = 0.16 * cm
    center_x = 4.00 * cm
    max_half = 1.90 * cm
    bar_h = 0.20 * cm
    row_h = 0.38 * cm
    first_y = height - 0.30 * cm
    last_y = first_y - (len(summary) - 1) * row_h

    c.setStrokeColor(colors.HexColor("#999999"))
    c.setDash(1.5, 1.5)
    c.line(center_x, last_y - 0.03 * cm, center_x, first_y + bar_h + 0.03 * cm)
    c.setDash()

    y = first_y
    for _, row in summary.iterrows():
        n = max(int(row["N"]), 1)
        counts = {score: int(row[f"Rating_{score}_count"]) for score in range(1, 6)}
        negative = (counts[1] + counts[2]) / n * 100
        positive = (counts[4] + counts[5]) / n * 100

        c.setFillColor(colors.black)
        c.setFont(font, 6.15)
        c.drawString(label_x, y + 0.02 * cm, str(row["Item"]))

        left_cursor = center_x
        for score in (3, 2, 1):
            fraction = counts[score] / n
            if score == 3:
                fraction /= 2
            segment = fraction * max_half
            left_cursor -= segment
            if segment:
                c.setFillColor(palette[score])
                c.rect(left_cursor, y, segment, bar_h, fill=1, stroke=0)

        right_cursor = center_x
        neutral_segment = (counts[3] / n / 2) * max_half
        if neutral_segment:
            c.setFillColor(palette[3])
            c.rect(right_cursor, y, neutral_segment, bar_h, fill=1, stroke=0)
            right_cursor += neutral_segment
        for score in (4, 5):
            segment = counts[score] / n * max_half
            if segment:
                c.setFillColor(palette[score])
                c.rect(right_cursor, y, segment, bar_h, fill=1, stroke=0)
                right_cursor += segment

        c.setFillColor(colors.black)
        c.setFont(font, 5.95)
        c.drawRightString(left_cursor - 0.06 * cm, y + 0.02 * cm, f"{negative:.1f}%")
        c.drawString(right_cursor + 0.06 * cm, y + 0.02 * cm, f"{positive:.1f}%")
        y -= row_h

    legend_y = max(0.15 * cm, y + 0.04 * cm)
    legend_font_size = 5.75
    c.setFont(font, legend_font_size)
    for score, label, x in legend_item_layout(
        width, font, legend_font_size, left_anchor, right_anchor
    ):
        c.setFillColor(palette[score])
        c.circle(x, legend_y + 0.065 * cm, 0.065 * cm, fill=1, stroke=0)
        c.setFillColor(colors.black)
        c.drawString(x + 0.18 * cm, legend_y, label)
    c.save()


def crop_pdf(path: Path, dpi: int = 240, padding_px: int = 10) -> None:
    pdftoppm = Path(
        r"C:\Users\ROSE\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\poppler\Library\bin\pdftoppm.exe"
    )
    if not pdftoppm.exists():
        return
    temp = path.parent / ".render_temp"
    temp.mkdir(exist_ok=True)
    prefix = temp / path.stem
    subprocess.run([str(pdftoppm), "-png", "-r", str(dpi), str(path), str(prefix)], check=True)
    image_path = next(temp.glob(path.stem + "-*.png"))
    image = Image.open(image_path).convert("RGB")
    background = Image.new("RGB", image.size, "white")
    diff = Image.eval(Image.fromarray(abs_image_difference(image, background)), lambda pixel: 255 if pixel > 10 else 0)
    bbox = diff.getbbox()
    if bbox is None:
        return
    left, top, right, bottom = bbox
    left = max(0, left - padding_px)
    top = max(0, top - padding_px)
    right = min(image.width, right + padding_px)
    bottom = min(image.height, bottom + padding_px)
    reader = PdfReader(str(path))
    page = reader.pages[0]
    page_width = float(page.mediabox.width)
    page_height = float(page.mediabox.height)
    rect = RectangleObject(
        [
            left / image.width * page_width,
            (image.height - bottom) / image.height * page_height,
            right / image.width * page_width,
            (image.height - top) / image.height * page_height,
        ]
    )
    page.mediabox = rect
    page.cropbox = rect
    page.trimbox = rect
    writer = PdfWriter()
    writer.add_page(page)
    with path.open("wb") as handle:
        writer.write(handle)
    image_path.unlink(missing_ok=True)
    try:
        temp.rmdir()
    except OSError:
        pass


def abs_image_difference(first: Image.Image, second: Image.Image):
    import numpy as np

    a = np.asarray(first, dtype=int)
    b = np.asarray(second, dtype=int)
    return np.max(np.abs(a - b), axis=2).astype("uint8")


def write_outputs(input_path: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    df = pd.read_csv(input_path, encoding="utf-8-sig")
    validate_data(df)
    primary, detail = build_rating_tables(df)
    task_pairs = build_task_pairs(df)
    demographics = build_demographics(df)
    coding, themes, participants = build_qualitative_tables(df)

    tables = {
        "Rating_Summary": primary,
        "Task_Detail": detail,
        "Task_Pairs": task_pairs,
        "Demographics": demographics,
        "Qualitative_Coding": coding,
        "Theme_Summary": themes,
        "Participants": participants,
    }
    for name, table in tables.items():
        if name != "Rating_Summary":
            table.to_csv(output_dir / f"{name.lower()}.csv", index=False, encoding="utf-8-sig")

    primary.to_csv(output_dir / "pilot_rating_summary.csv", index=False, encoding="utf-8-sig")
    task_pdf = output_dir / "pilot_task_helpfulness.pdf"
    post_pdf = output_dir / "pilot_poststudy_agreement.pdf"
    draw_rating_pdf(
        primary.iloc[:2],
        task_pdf,
        "Not helpful at all",
        "Very helpful",
    )
    draw_rating_pdf(
        primary.iloc[2:],
        post_pdf,
        "Strongly disagree",
        "Strongly agree",
    )
    crop_pdf(task_pdf)
    crop_pdf(post_pdf)
    (output_dir / "pilot_likert_summary.pdf").unlink(missing_ok=True)

    payload = {
        "method": {
            "sample": "6 participants",
            "task_aggregation": "Agent and knowledge-graph ratings are pooled across two task contexts (12 task-level ratings per component); no inferential test treats them as independent participants.",
            "likert_summary": "Per-item counts, median, and range.",
            "qualitative_unit": "One participant response to one prompt (36 units).",
            "qualitative_method": "Hybrid deductive-inductive content analysis; participants counted once per theme.",
        },
        "tables": {name: json.loads(table.to_json(orient="records", force_ascii=False)) for name, table in tables.items()},
        "raw_data": json.loads(df.to_json(orient="records", force_ascii=False)),
    }
    (output_dir / "pilot_analysis_tables.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    args = parse_args()
    write_outputs(args.input_csv, args.output_dir)
    print(args.output_dir)


if __name__ == "__main__":
    main()
