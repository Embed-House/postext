"""Tests of the delivery gate (#1148): `composed_check.py check` fails on
unknownConfigKey / unknownConfigValue, prints every other warning,
`--json-out FILE` keeps the report and the exit code, and `preset_kit.py
pack` refuses while the saved result failed.

A stand-in for the `postext` command line answers `--version` and `check
--json` with a fixed report, so the tests need no Postext install.

    python3 -m pytest plugins/postext/skills/postext-port/scripts/tests -q
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
import composed_check as cc  # noqa: E402
import preset_kit as kit  # noqa: E402

FAKE = '''import json, sys
args = sys.argv[1:]
if args == ["--version"]:
    print("postext 1.50.0 (engine 1.50.0)")
elif args and args[0] == "check":
    print(json.dumps({"warnings": json.loads(open(sys.argv[0] + ".json").read())}))
'''


def book(root: Path, warnings: list[dict]) -> str:
    (root / "chapters").mkdir()
    (root / "chapters" / "01.md").write_text("# One\n\nText.\n", encoding="utf-8")
    (root / "preset.json").write_text(json.dumps({
        "version": 2, "configVersion": 16, "id": "t", "name": "T", "locale": "en", "config": {},
        "chapters": {"en": [{"title": "One", "file": "chapters/01.md"}]}}), encoding="utf-8")
    fake = root / "fake_postext.py"
    fake.write_text(FAKE, encoding="utf-8")
    Path(str(fake) + ".json").write_text(json.dumps(warnings), encoding="utf-8")
    return f"{sys.executable} {fake}"


def check(root: Path, cmd: str, *extra: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS / "composed_check.py"), "check", str(root), "--postext", cmd,
                           "--no-html", *extra], capture_output=True, text=True)


class Judge(unittest.TestCase):
    def test_unknown_settings_fail(self):
        v = cc.judge({"warnings": [
            {"kind": "unknownConfigKey", "severity": "warning", "message": "frameLook is not a setting"},
            {"kind": "unknownConfigValue", "severity": "warning", "message": "align 'middel'"}]})
        self.assertEqual([w["kind"] for w in v["fail"]], ["unknownConfigKey", "unknownConfigValue"])

    def test_other_warnings_are_listed(self):
        v = cc.judge({"warnings": [{"kind": "raggedLine", "severity": "warning", "message": "r", "page": "4"}]})
        self.assertEqual(v["fail"], [])
        self.assertEqual([w["kind"] for w in v["warn"]], ["raggedLine"])


class CommandLine(unittest.TestCase):
    def test_json_out_keeps_the_report_and_the_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cmd = book(root, [{"kind": "unknownConfigKey", "severity": "warning", "message": "frameLook"},
                              {"kind": "raggedLine", "severity": "warning", "message": "a ragged line", "page": "2"}])
            r = check(root, cmd, "--json-out", str(root / "work" / "check.json"))
            self.assertEqual(r.returncode, 1, r.stderr)
            self.assertIn("FAIL unknownConfigKey", r.stdout)
            self.assertIn("WARN raggedLine", r.stdout)
            self.assertTrue(r.stdout.rstrip().endswith("failed"))
            saved = json.loads((root / "work" / "check.json").read_text(encoding="utf-8"))
            self.assertIs(saved["passed"], False)

    def test_pack_refuses_while_the_saved_check_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cmd = book(root, [{"kind": "frameCovered", "severity": "warning", "message": "photo under pill",
                               "data": {"frame": "photo", "coveredBy": "pill"}}])
            self.assertEqual(check(root, cmd, "--json-out", str(root / "work" / "check.json")).returncode, 1)
            why = kit.check_refusal(root)
            self.assertIsNotNone(why)
            self.assertIn("1 overlap(s)", why)
            pack = [sys.executable, str(SCRIPTS / "preset_kit.py"), "pack", str(root), "--manifest-only",
                    "--out", str(root / "t.postext")]
            r = subprocess.run(pack, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("composed-page check failed", r.stderr)
            self.assertFalse((root / "t.postext").exists())
            r = subprocess.run([*pack, "--ignore-check"], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertTrue((root / "t.postext").exists())

    def test_pack_after_a_passed_check_or_without_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cmd = book(root, [{"kind": "raggedLine", "severity": "warning", "message": "r"}])
            self.assertIsNone(kit.check_refusal(root))  # no saved result
            self.assertEqual(check(root, cmd, "--json-out", str(root / "work" / "check.json")).returncode, 0)
            self.assertIsNone(kit.check_refusal(root))
            self.assertIn("no such file", kit.check_refusal(root, str(root / "missing.json")))

    def test_a_failed_result_of_another_project_is_not_read(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "work").mkdir()
            (root / "work" / "check.json").write_text(json.dumps(
                {"target": str(root / "elsewhere" / "preset.json"), "passed": False, "editions": {}}))
            self.assertIsNone(kit.check_refusal(root))
            self.assertIsNotNone(kit.check_refusal(root, str(root / "work" / "check.json")))


if __name__ == "__main__":
    unittest.main()
