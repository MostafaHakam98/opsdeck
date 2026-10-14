from pathlib import Path
import re


def test_handbook_relative_links_resolve():
    root = Path(__file__).resolve().parents[1]
    pages = [root / "README.md", *sorted((root / "docs").glob("*.md"))]
    for page in pages:
        for target in re.findall(r"\[[^\]]+\]\(([^\s)]+)\)", page.read_text()):
            if "://" in target or target.startswith("#"):
                continue
            relative = target.split("#", 1)[0]
            assert (page.parent / relative).exists(), f"Broken handbook link in {page.name}: {target}"
