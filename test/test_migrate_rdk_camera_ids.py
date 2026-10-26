"""Offline migration checks; never connects to a device or production database."""

import importlib.util
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "migrateRdkCameraIds.py"
SPEC = importlib.util.spec_from_file_location("rdk_camera_migration", SCRIPT)
MIGRATION = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MIGRATION)


class CameraMigrationTest(unittest.TestCase):
    def test_physical_settings_and_assignments_follow_original_camera(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "config").mkdir()
            (root / "data").mkdir()
            cameras = []
            for number in range(1, 5):
                cameras.append({"id": f"c110-{number}", "host": f"192.168.1.{100+number}",
                                "user_env": f"C110_{number}_USER",
                                "password_env": f"C110_{number}_PASSWORD"})
            (root / "config/main.json").write_text(
                json.dumps({"cameras": cameras}), encoding="utf-8")
            (root / ".env").write_text("\n".join(
                f"C110_{number}_{kind}=value-{number}-{kind}"
                for number in range(1, 5) for kind in ("USER", "PASSWORD")) + "\n",
                encoding="utf-8")
            (root / "data/perspective.json").write_text(
                json.dumps({f"c110-{number}": [number] for number in range(1, 5)}),
                encoding="utf-8")
            (root / "data/grid_layouts.json").write_text(
                json.dumps({"c110-1": [{"id": "grid-1", "anchors": [[0, 0], [1, 1]]}]}),
                encoding="utf-8")
            with closing(sqlite3.connect(root / "data/main.sqlite3")) as db:
                db.execute("CREATE TABLE assignments (user_id TEXT PRIMARY KEY, camera_id TEXT, "
                           "zone INTEGER, token_nonce TEXT, UNIQUE(camera_id, zone))")
                for number in range(1, 5):
                    db.execute("INSERT INTO assignments VALUES (?, ?, ?, ?)",
                               (f"plant-{number}", f"c110-{number}", 1, f"nonce-{number}"))
                db.commit()

            plan = MIGRATION.migrate(root, release_ids=["plant-2"])
            self.assertFalse(plan["applied"])
            self.assertEqual(plan["release_count"], 1)
            self.assertEqual(plan["new_hosts"], {"c110-1": "192.168.1.104",
                                                  "c110-2": "192.168.1.101",
                                                  "c110-3": "192.168.1.103",
                                                  "c110-4": "192.168.1.102"})
            self.assertFalse((root / "deploy-backups").exists())
            with self.assertRaisesRegex(ValueError, "fingerprint"):
                MIGRATION.migrate(root, "wrong", release_ids=["plant-2"])
            result = MIGRATION.migrate(root, plan["fingerprint"], release_ids=["plant-2"])
            self.assertTrue(result["applied"])
            self.assertTrue(Path(result["backup"]).is_dir())
            updated = json.loads((root / "config/main.json").read_text(encoding="utf-8"))
            self.assertEqual([camera["host"] for camera in updated["cameras"]],
                             ["192.168.1.104", "192.168.1.101",
                              "192.168.1.103", "192.168.1.102"])
            env = (root / ".env").read_text(encoding="utf-8")
            self.assertIn("C110_1_USER=value-4-USER", env)
            self.assertIn("C110_4_PASSWORD=value-2-PASSWORD", env)
            perspective = json.loads((root / "data/perspective.json").read_text(encoding="utf-8"))
            self.assertEqual(perspective["c110-1"], [4])
            grids = json.loads((root / "data/grid_layouts.json").read_text(encoding="utf-8"))
            self.assertEqual(grids, {})
            with closing(sqlite3.connect(root / "data/main.sqlite3")) as db:
                rows = dict(db.execute("SELECT user_id, camera_id FROM assignments"))
            self.assertEqual(rows, {"plant-1": "c110-2",
                                    "plant-3": "c110-3", "plant-4": "c110-1"})
            with self.assertRaisesRegex(ValueError, "precondition"):
                MIGRATION.migrate(root)


if __name__ == "__main__":
    unittest.main()
