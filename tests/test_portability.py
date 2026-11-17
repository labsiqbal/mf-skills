"""Run: python3 tests/test_portability.py. Offline checks; no browser downloads."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "skills/mf-masterplan/scripts/render-diagrams.py"
spec = importlib.util.spec_from_file_location("render_diagrams", path)
renderer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(renderer)


def check(root):
    return subprocess.run(
        [sys.executable, str(root / "scripts/check.py")],
        cwd=root.parent, capture_output=True, text=True,
    )


with tempfile.TemporaryDirectory(prefix="mf-portability-") as directory:
    root = Path(directory) / "checkout with spaces"
    for name in ("skills", "scripts"):
        shutil.copytree(ROOT / name, root / name, ignore=shutil.ignore_patterns("__pycache__"))
    result = check(root)
    assert result.returncode == 0, result.stdout + result.stderr
    doc = root / "skills/mf-design/SKILL.md"
    original = doc.read_text()
    for binding in ("/home/someone/projects/app", "/Users/someone/project",
                    r"C:\Users\someone\project", "https://machine.private.ts.net"):
        doc.write_text(original + "\nRead " + binding + "\n")
        result = check(root)
        assert result.returncode != 0 and "Machine-bound" in result.stderr, binding
    doc.write_text(original)
    outside = root / "private.md"
    outside.write_text("# Not part of the installed package\n")
    doc.write_text(original + "\n[Hidden prerequisite](../../private.md)\n")
    assert "Link escapes package" in check(root).stderr
    doc.write_text(original)
    if os.name != "nt":
        escaped = doc.with_name("private.md")
        escaped.symlink_to(outside)
        assert "Resource escapes package" in check(root).stderr
        escaped.unlink()
    license_path = doc.with_name("LICENSE")
    license_path.unlink()
    assert "Missing standalone license" in check(root).stderr


with patch.dict(os.environ, {"PUPPETEER_EXECUTABLE_PATH": "/custom/browser"}, clear=True):
    with patch.object(renderer.shutil, "which", side_effect=lambda name: "/bin/npx" if name == "npx" else None):
        assert renderer.renderer() is None, "Default must not download a renderer"
        command, env = renderer.renderer(allow_download=True)
        assert command == ["npx", "-y", renderer.MERMAID_CLI]
        assert env["PUPPETEER_EXECUTABLE_PATH"] == "/custom/browser"
    with patch.object(renderer.shutil, "which", side_effect=lambda name: "/bin/mmdc" if name == "mmdc" else None):
        assert renderer.renderer()[0] == ["mmdc"]


with tempfile.TemporaryDirectory(prefix="mf-render-") as directory:
    root = Path(directory) / "package with spaces"
    root.mkdir()
    (root / "masterplan.md").write_text("# Plan\n\n## 11. Architecture\n\n```mermaid\nflowchart LR\n  A --> B\n```\n")
    result = subprocess.run(
        [sys.executable, str(path), str(root)],
        env={**os.environ, "PATH": ""}, capture_output=True, text=True,
    )
    assert result.returncode == 2 and "NO RENDERER" in result.stdout, result.stderr
    assert not (root / "references").exists()

    def render(command, **kwargs):
        assert "-p" not in command and "--no-sandbox" not in command
        target = Path(command[command.index("-o") + 1])
        target.write_text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        return subprocess.CompletedProcess(command, 0, "", "")

    with patch.object(renderer, "renderer", return_value=None):
        assert renderer.main([str(root), "--dry-run"]) == 0
        assert renderer.main([str(root)]) == 2
        assert not (root / "references").exists()
    with patch.object(renderer, "renderer", return_value=(["mmdc"], dict(os.environ))):
        with patch.object(renderer.subprocess, "run", side_effect=render):
            assert renderer.main([str(root)]) == 0
            assert (root / "references/diagrams/s11-1.svg").is_file()
        with patch.object(renderer.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "Error: renderer failed")):
            assert renderer.main([str(root)]) == 1

print("PASS: isolated packages, portability guards and renderer permissions")
