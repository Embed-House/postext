"""Tests of the curation tables (#1136): `pdf_regions.py manifest --patch
curation.json` applies the hand fixes of a composed-page draft after each
build, so a rebuild keeps them, and fails on a target that does not exist.

    python3 -m pytest plugins/postext/skills/postext-port/scripts/tests -q
"""
from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
import preset_kit as kit  # noqa: E402

MM = lambda v: {"value": v, "unit": "mm"}  # noqa: E731

LIBRARY = {
    "pageTemplates": [{
        "id": "tema",
        "frames": [{"name": "titulo", "takes": "h1"}, {"name": "texto", "flow": True},
                   {"name": "foto", "placement": {"anchor": {"to": "#texto", "edge": "below"}}},
                   {"name": "pill"}],
        "groups": [{"name": "pila", "kind": "stack", "frames": ["texto", "foto"]}],
        "decoration": {"elements": [{"kind": "path", "id": "path-1"}, {"kind": "box", "id": "box-2"}]},
    }],
    "calloutStyles": [{"id": "caja", "body": {"fontSize": {"value": 10, "unit": "pt"}}}],
}


def manifest() -> dict:
    return {"config": copy.deepcopy(LIBRARY), "resources": [{"id": "p01-foto", "typeId": "figure"}]}


CURATION = {
    "framePatch": [{"template": "tema", "frame": "titulo", "set": {"maxHeight": MM(20)}, "reason": "two-line titles"}],
    "frameDrop": [{"template": "tema", "frame": "foto", "reason": "a scanning artefact, not a picture"}],
    "frameAdd": [{"template": "tema", "frame": {"name": "nota"}, "after": "texto", "reason": "the side note"}],
    "decorationDrop": [{"template": "tema", "element": "path-1", "reason": "a crop mark"}],
    "overlapAllow": [{"template": "tema", "frame": "pill", "reason": "the source sets the pill over the photo"}],
    "styles": [{"table": "calloutStyles", "id": "caja", "set": {"body": {"fontSize": {"value": 9.5}}},
                "reason": "the source's box text is 9.5 pt"}],
    "resources": [{"resource": {"id": "p01-mapa", "typeId": "figure", "file": "resources/mapa.svg"},
                   "reason": "the map the extract left in the ground"}],
}


class Apply(unittest.TestCase):
    def test_every_table(self):
        m = manifest()
        done = kit.apply_curation(m, CURATION)
        self.assertEqual(len(done), 7)
        t = m["config"]["pageTemplates"][0]
        self.assertEqual([f["name"] for f in t["frames"]], ["titulo", "texto", "nota", "pill"])
        self.assertEqual(t["frames"][0]["maxHeight"], MM(20))
        self.assertEqual(t["frames"][3]["overlap"], "allow")
        self.assertEqual(t["groups"][0]["frames"], ["texto"])
        self.assertEqual([e["id"] for e in t["decoration"]["elements"]], ["box-2"])
        self.assertEqual(m["config"]["calloutStyles"][0]["body"]["fontSize"], {"value": 9.5, "unit": "pt"})
        self.assertEqual([r["id"] for r in m["resources"]], ["p01-foto", "p01-mapa"])

    def test_unknown_targets_fail_and_change_nothing(self):
        m = manifest()
        bad = {"framePatch": [{"template": "tema", "frame": "titular", "set": {}, "reason": "r"}],
               "frameDrop": [{"template": "otro", "frame": "x", "reason": "r"}],
               "decorationDrop": [{"template": "tema", "element": "path-9", "reason": "r"}],
               "styles": [{"table": "calloutStyles", "id": "nada", "set": {}, "reason": "r"}],
               "overlapAllow": [{"template": "tema", "frame": "pill"}],
               "resources": [{"resource": {"id": "p01-foto", "typeId": "figure"}, "reason": "r"}],
               "frameMove": []}
        with self.assertRaises(SystemExit) as cm:
            kit.apply_curation(m, bad)
        msg = str(cm.exception)
        for needle in ("no frame 'titular'", "no page template 'otro'", "no decoration element 'path-9'",
                       "no style 'nada'", "overlapAllow[0] has no reason", "'p01-foto' exists already",
                       "unknown table(s) ['frameMove']"):
            self.assertIn(needle, msg)
        self.assertEqual(m, manifest())

    def test_add_after_a_dropped_frame_fails(self):
        cur = {"frameDrop": [{"template": "tema", "frame": "foto", "reason": "r"}],
               "frameAdd": [{"template": "tema", "frame": {"name": "n"}, "after": "foto", "reason": "r"}]}
        with self.assertRaises(SystemExit):
            kit.apply_curation(manifest(), cur)

    def test_the_empty_file_applies_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = kit.write_empty_curation(tmp)
            self.assertIsNotNone(path)
            self.assertIsNone(kit.write_empty_curation(tmp))  # an existing one is kept
            m = manifest()
            self.assertEqual(kit.apply_curation(m, json.loads(path.read_text(encoding="utf-8"))), [])
            self.assertEqual(m, manifest())


class ManifestRerun(unittest.TestCase):
    def test_a_rerun_of_manifest_keeps_every_curation(self):
        import pdf_regions  # noqa: PLC0415 - needs PyMuPDF

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "regions"
            (root / "chapters" / "es").mkdir(parents=True)
            (root / "resources").mkdir()
            (root / "resources" / "mapa.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
            (root / "chapters" / "es" / "01-pages.md").write_text('::::page{template="tema"}\n# Uno\n::::\n')
            (root / "library.json").write_text(json.dumps(LIBRARY))
            (root / "resources.json").write_text(json.dumps([]))
            kit.write_empty_curation(root)
            cur = json.loads((root / kit.CURATION_FILE).read_text(encoding="utf-8"))
            cur["overlapAllow"] = CURATION["overlapAllow"]
            cur["resources"] = CURATION["resources"]
            (root / kit.CURATION_FILE).write_text(json.dumps(cur))
            for _ in range(2):  # the second run starts again from library.json
                self.assertEqual(pdf_regions.main(["manifest", str(root), "--id", "t"]), 0)
                m = json.loads((root / "preset.json").read_text(encoding="utf-8"))
                pill = [f for f in m["config"]["pageTemplates"][0]["frames"] if f["name"] == "pill"][0]
                self.assertEqual(pill.get("overlap"), "allow")
                self.assertEqual([r["id"] for r in m["resources"]], ["p01-mapa"])
            with self.assertRaises(SystemExit):
                pdf_regions.main(["manifest", str(root), "--patch", str(root / "missing.json")])


if __name__ == "__main__":
    unittest.main()
