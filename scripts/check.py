"""Run: python3 scripts/check.py. Validate this repository's skill packages."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
packages = sorted((root / "skills").iterdir())
assert packages, "No skill packages"
for package in packages:
    entry = package / "SKILL.md"
    source = entry.read_text()
    assert source.startswith("---\n"), f"Missing frontmatter: {entry}"
    header, body = source[4:].split("\n---\n", 1)
    assert re.search(rf"^name: {re.escape(package.name)}$", header, re.M), entry
    assert re.search(r"^description: .+", header, re.M), entry
    assert re.search(r'^  version: "\d+\.\d+\.\d+"$', header, re.M), entry
    status = re.search(r"^  status: (draft|ready|released)$", header, re.M)
    assert status, f"Invalid status: {entry}"
    assert re.search(r"^  author: .+", header, re.M), entry
    if status[1] == "released":
        assert re.search(r"^  release-tag: .+", header, re.M), entry
    assert body.strip(), f"Empty skill: {entry}"
    for doc in package.rglob("*.md"):
        for target in re.findall(r"\]\(([^)]+)\)", doc.read_text()):
            if "://" in target or target.startswith(("#", "mailto:")):
                continue
            target = target.split("#", 1)[0].strip("<>")
            if target:
                assert (doc.parent / target).exists(), f"Broken link: {doc}: {target}"
print(f"PASS: {len(packages)} packages, metadata and relative references")
