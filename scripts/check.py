"""Run: python3 scripts/check.py. Validate this repository's skill packages."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
packages = sorted((root / "skills").iterdir())
assert packages, "No skill packages"
# ponytail: catches common machine bindings, not all secrets or workflow assumptions; review prose too.
machine_binding = re.compile(
    r"/(?:home|Users)/[\w.-]+/|[A-Za-z]:\\Users\\[\w.-]+\\"
    r"|https?://[\w.-]+\.ts\.net\b"
)
for package in packages:
    entry = package / "SKILL.md"
    source = entry.read_text(encoding="utf-8")
    assert source.startswith("---\n"), f"Missing frontmatter: {entry}"
    header, body = source[4:].split("\n---\n", 1)
    assert re.search(rf"^name: {re.escape(package.name)}$", header, re.M), entry
    assert re.search(r"^description: .+", header, re.M), entry
    assert re.search(r"^license: MIT$", header, re.M), entry
    assert (package / "LICENSE").is_file(), f"Missing standalone license: {package}"
    assert re.search(r'^  version: "\d+\.\d+\.\d+"$', header, re.M), entry
    status = re.search(r"^  status: (draft|ready|released)$", header, re.M)
    assert status, f"Invalid status: {entry}"
    assert re.search(r"^  author: .+", header, re.M), entry
    if status[1] == "released":
        assert re.search(r"^  release-tag: .+", header, re.M), entry
    assert body.strip(), f"Empty skill: {entry}"
    for path in package.rglob("*"):
        assert path.resolve().is_relative_to(package.resolve()), f"Resource escapes package: {path}"
        if path.is_file() and path.suffix in {".md", ".py", ".yaml", ".yml"}:
            assert not machine_binding.search(path.read_text(encoding="utf-8")), f"Machine-bound path or host: {path}"
    for doc in package.rglob("*.md"):
        # ponytail: template links resolve in output packages; validate-package.py checks them there.
        if doc.name.endswith("-template.md"):
            continue
        prose = re.sub(r"(?ms)^```[^\n]*\n.*?^```[ \t]*$", "", doc.read_text(encoding="utf-8"))
        for target in re.findall(r"\]\(([^)]+)\)", prose):
            if "://" in target or target.startswith(("#", "mailto:")):
                continue
            target = target.split("#", 1)[0].strip("<>")
            if target:
                resolved = (doc.parent / target).resolve()
                assert resolved.is_relative_to(package.resolve()), f"Link escapes package: {doc}: {target}"
                assert resolved.exists(), f"Broken link: {doc}: {target}"
print(f"PASS: {len(packages)} packages, metadata, licenses, portability and relative references")
