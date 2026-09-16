from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN = [
    "openid",
    "wechat",
    "微信号",
    "ip address",
    "IP地址",
]

SKIP_DIRS = {
    ".git",
    ".tools",
    "node_modules",
    "dist",
    ".umi",
    ".umi-production",
}

SKIP_FILES = {
    "docs/architecture.md",
    "docs/construction-plan.md",
    "docs/education-agent-skills-inventory.md",
    "harness/cases/index-error-demo.yaml",
    "scripts/check_privacy_fields.py",
}

SCAN_SUFFIXES = {
    ".go",
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".mjs",
    ".yaml",
    ".yml",
    ".md",
    ".sh",
    ".ps1",
}


def should_scan(path: Path) -> bool:
    relative = path.relative_to(ROOT).as_posix()
    if relative.startswith("data/raw/"):
        return False
    if relative in SKIP_FILES:
        return False
    if path.suffix not in SCAN_SUFFIXES:
        return False
    return not any(part in SKIP_DIRS for part in path.parts)


def main() -> None:
    hits = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or not should_scan(path):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore").lower()
        for term in FORBIDDEN:
            if term.lower() in text:
                hits.append(f"{path.relative_to(ROOT)}: {term}")

    if hits:
        raise SystemExit("Privacy keyword review required:\n" + "\n".join(hits))

    print("Privacy field checks passed.")


if __name__ == "__main__":
    main()
