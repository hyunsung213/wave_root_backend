"""Rename the four *physical* C110 cameras without losing their settings.

Run only while smartfarm-main.service is stopped. Dry run is the default.
This script never prints camera credentials or stream tokens.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


OLD_TO_NEW = {"c110-1": "c110-2", "c110-2": "c110-4",
              "c110-3": "c110-3", "c110-4": "c110-1"}
EXPECTED_OLD_HOSTS = {"c110-1": "192.168.1.101", "c110-2": "192.168.1.102",
                      "c110-3": "192.168.1.103", "c110-4": "192.168.1.104"}
JSON_FILES = ("data/calibration.json", "data/grid_layouts.json",
              "data/perspective.json", "data/stream_profiles.json")
# The old c110-1 has only eight manually drawn cells. Its new identity c110-2
# must expose the authoritative 6x3/18-cell bed instead. The backup preserves
# those eight custom rectangles for a later manual re-calibration if needed.
RESET_GRID_FOR_OLD_CAMERA = "c110-1"
CAMERA_ENV = re.compile(r"^(C110_)([1-4])(_USER|_PASSWORD)(=.*)$")


def _files(root):
    names = ["config/main.json", ".env", "data/main.sqlite3"]
    names.extend(name for name in JSON_FILES if (root / name).exists())
    return [root / name for name in names]


def _read_state(root, release_ids):
    files = _files(root)
    for path in files[:3]:
        if not path.is_file():
            raise ValueError(f"required file is missing: {path.relative_to(root)}")
    if (root / "data/main.sqlite3-wal").exists() or (root / "data/main.sqlite3-shm").exists():
        raise ValueError("SQLite sidecar exists; stop the service and checkpoint SQLite before migration")
    config = json.loads(files[0].read_text(encoding="utf-8"))
    cameras = config.get("cameras")
    if not isinstance(cameras, list) or len(cameras) != 4:
        raise ValueError("expected exactly four cameras")
    hosts = {camera["id"]: camera["host"] for camera in cameras}
    if hosts != EXPECTED_OLD_HOSTS:
        raise ValueError("camera ID/host precondition failed; migration may already be applied")
    env_text = files[1].read_text(encoding="utf-8")
    env_keys = [match.group(1) + match.group(2) + match.group(3)
                for line in env_text.splitlines()
                if (match := CAMERA_ENV.match(line))]
    required = {f"C110_{number}_{kind}" for number in range(1, 5)
                for kind in ("USER", "PASSWORD")}
    if set(env_keys) != required or len(env_keys) != len(required):
        raise ValueError("expected exactly eight unique C110 user/password environment keys")
    overrides = {}
    for name in JSON_FILES:
        path = root / name
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not set(data).issubset(OLD_TO_NEW):
                raise ValueError(f"invalid camera IDs in {name}")
            overrides[name] = data
    with closing(sqlite3.connect(root / "data/main.sqlite3")) as db:
        assignments = db.execute("SELECT user_id, camera_id, zone FROM assignments ORDER BY user_id").fetchall()
    if any(camera_id not in OLD_TO_NEW for _, camera_id, _ in assignments):
        raise ValueError("SQLite assignments include unknown cameras")
    assignment_ids = {user_id for user_id, _, _ in assignments}
    if len(release_ids) != len(set(release_ids)) or not set(release_ids).issubset(assignment_ids):
        raise ValueError("release IDs must be unique existing assignment IDs")
    rows = sorted((camera_id, sum(1 for _, assigned_camera, _ in assignments
                                   if assigned_camera == camera_id)) for camera_id in OLD_TO_NEW)
    digest = hashlib.sha256()
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(path.read_bytes())
    digest.update(json.dumps(sorted(release_ids)).encode("utf-8"))
    return config, env_text, overrides, rows, assignments, files, digest.hexdigest()


def _new_config(config):
    result = json.loads(json.dumps(config))
    for camera in result["cameras"]:
        old_id = camera["id"]
        new_id = OLD_TO_NEW[old_id]
        camera["id"] = new_id
        for kind in ("USER", "PASSWORD"):
            key = f"{kind.lower()}_env"
            if camera.get(key) != f"C110_{old_id[-1]}_{kind}":
                raise ValueError(f"unexpected {key} reference for {old_id}")
            camera[key] = f"C110_{new_id[-1]}_{kind}"
    result["cameras"].sort(key=lambda camera: camera["id"])
    if "legacy_zone_map" in result:
        result["legacy_zone_map"] = {
            OLD_TO_NEW[key]: value for key, value in result["legacy_zone_map"].items()}
    return result


def _new_env(env_text):
    def rename_line(line):
        match = CAMERA_ENV.match(line)
        if not match:
            return line
        new_number = OLD_TO_NEW[f"c110-{match.group(2)}"][-1]
        return f"{match.group(1)}{new_number}{match.group(3)}{match.group(4)}"

    return "".join(rename_line(line.rstrip("\r\n")) + line[len(line.rstrip("\r\n")):]
                   for line in env_text.splitlines(keepends=True))


def _atomic_write(path, data, mode):
    handle, temporary = tempfile.mkstemp(prefix=".camera-migration-", dir=path.parent)
    try:
        with os.fdopen(handle, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def migrate(root, confirm=None, release_ids=()):
    config, env_text, overrides, rows, assignments, files, fingerprint = _read_state(root, release_ids)
    if confirm is None:
        return {"fingerprint": fingerprint, "assignments": dict(rows),
                "release_count": len(release_ids),
                "new_hosts": {OLD_TO_NEW[old]: host for old, host in EXPECTED_OLD_HOSTS.items()},
                "applied": False}
    if confirm != fingerprint:
        raise ValueError("plan fingerprint changed; inspect and plan again")
    backup = root / "deploy-backups" / ("camera-id-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
    backup.mkdir(parents=True, exist_ok=False, mode=0o700)
    os.chmod(backup, 0o700)
    for path in files:
        destination = backup / path.relative_to(root)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        os.chmod(destination, 0o600)
    try:
        changes = {"config/main.json": _new_config(config),
                   **{name: {OLD_TO_NEW[key]: value for key, value in data.items()
                             if name != "data/grid_layouts.json" or key != RESET_GRID_FOR_OLD_CAMERA}
                      for name, data in overrides.items()}}
        for name, data in changes.items():
            path = root / name
            encoded = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            _atomic_write(path, encoded, path.stat().st_mode & 0o777)
        env_path = root / ".env"
        _atomic_write(env_path, _new_env(env_text).encode("utf-8"), env_path.stat().st_mode & 0o777)
        with closing(sqlite3.connect(root / "data/main.sqlite3")) as db:
            db.execute("BEGIN IMMEDIATE")
            for old in OLD_TO_NEW:
                db.execute("UPDATE assignments SET camera_id=? WHERE camera_id=?",
                           (f"migration-{old}", old))
            for old, new in OLD_TO_NEW.items():
                db.execute("UPDATE assignments SET camera_id=? WHERE camera_id=?",
                           (new, f"migration-{old}"))
            for user_id in release_ids:
                db.execute("DELETE FROM assignments WHERE user_id=?", (user_id,))
            db.commit()
        current = json.loads((root / "config/main.json").read_text(encoding="utf-8"))
        expected_hosts = {OLD_TO_NEW[old]: host for old, host in EXPECTED_OLD_HOSTS.items()}
        if {camera["id"]: camera["host"] for camera in current["cameras"]} != expected_hosts:
            raise ValueError("camera host verification failed")
        with closing(sqlite3.connect(root / "data/main.sqlite3")) as db:
            new_rows = dict(db.execute("SELECT camera_id, COUNT(*) FROM assignments GROUP BY camera_id"))
        expected_counts = {OLD_TO_NEW[key]: sum(1 for user_id, old_id, _ in assignments
                                               if old_id == key and user_id not in release_ids)
                           for key in OLD_TO_NEW}
        expected_counts = {key: count for key, count in expected_counts.items() if count}
        if new_rows != expected_counts:
            raise ValueError("assignment count verification failed")
    except Exception:
        for path in files:
            shutil.copy2(backup / path.relative_to(root), path)
        raise
    return {"fingerprint": fingerprint, "assignments": new_rows,
            "release_count": len(release_ids), "new_hosts": expected_hosts,
            "backup": str(backup), "applied": True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("/home/sunrise/smartfarm"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--confirm-plan")
    parser.add_argument("--release-ids-file", type=Path,
                        help="JSON array of plant IDs whose video assignment must be released")
    args = parser.parse_args()
    if args.apply != bool(args.confirm_plan):
        parser.error("--apply requires --confirm-plan, and --confirm-plan requires --apply")
    release_ids = json.loads(args.release_ids_file.read_text(encoding="utf-8")) if args.release_ids_file else []
    if not isinstance(release_ids, list) or any(not isinstance(value, str) or not value
                                                for value in release_ids):
        parser.error("--release-ids-file must contain a JSON array of nonempty plant ID strings")
    result = migrate(args.root.resolve(), args.confirm_plan, release_ids)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
