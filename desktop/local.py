import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
from pathlib import Path

from modelo import mark_id, model

DATA_DIR = Path(os.getenv("LOCALAPPDATA") or Path.home() / ".local" / "share") / "FrequenciaLAMPI"
DEFAULTS = {
    "title": "Frequência dos Laboratórios", "lab": "LAMPI e GCOMPH",
    "campus": "IFCE · Campus Canindé", "teacher": "", "group": "lampi",
    "shift": "manha", "theme": "dark",
}


class LocalStore:
    def __init__(self, directory=DATA_DIR):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "frequencia.sqlite3"
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS remote (
                group_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (group_id, key));
            CREATE TABLE IF NOT EXISTS marks (
                group_id TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY (group_id, id));
            CREATE TABLE IF NOT EXISTS scans (
                group_id TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
                status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (group_id, id));
        """)

    def setting(self, key, default=None):
        with self.lock:
            row = self.db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_settings(self, values):
        with self.lock, self.db:
            self.db.executemany("INSERT OR REPLACE INTO settings VALUES (?,?)",
                                ((key, json.dumps(value)) for key, value in values.items()))

    def pin_matches(self, pin):
        saved = self.setting("admin_pin")
        if not saved:
            return False
        digest = hashlib.scrypt(pin.encode(), salt=bytes.fromhex(saved["salt"]), n=2**14, r=8, p=1)
        return hmac.compare_digest(digest.hex(), saved["digest"])

    def set_pin(self, pin):
        salt = secrets.token_bytes(16)
        digest = hashlib.scrypt(pin.encode(), salt=salt, n=2**14, r=8, p=1)
        self.set_settings({"admin_pin": {"salt": salt.hex(), "digest": digest.hex()}})

    def cached(self, group, key, default):
        with self.lock:
            row = self.db.execute("SELECT value FROM remote WHERE group_id=? AND key=?", (group, key)).fetchone()
        return json.loads(row[0]) if row else default

    def download(self, group, roster, legacy, marks, cursor, replace=False):
        with self.lock, self.db:
            self.db.executemany("INSERT OR REPLACE INTO remote VALUES (?,?,?)",
                                ((group, key, json.dumps(value)) for key, value in
                                 [("roster", roster), ("legacy", legacy), ("cursor", cursor)]))
            if replace:
                self.db.execute("DELETE FROM marks WHERE group_id=?", (group,))
            self.db.executemany("INSERT OR REPLACE INTO marks VALUES (?,?,?)",
                                ((group, key, json.dumps(value)) for key, value in marks.items()))

    def data(self, group):
        with self.lock:
            marks = {key: json.loads(value) for key, value in self.db.execute(
                "SELECT id,value FROM marks WHERE group_id=?", (group,))}
            for key, value in self.db.execute(
                    "SELECT id,value FROM scans WHERE group_id=? AND status='pending'", (group,)):
                # A decisão já recebida do site prevalece sobre uma leitura pendente.
                marks.setdefault(key, json.loads(value))
            return model(self.cached(group, "legacy", {}), self.cached(group, "roster", {}), marks)

    def scan(self, group, shift, tag, now):
        with self.lock, self.db:
            members, marks, _ = self.data(group)
            candidates = [(member_id, person) for member_id, person in members.items()
                          if person["active"] and person.get("tag") == tag]
            if len(candidates) != 1:
                return ("duplicate_tag", "") if candidates else ("unknown", "")
            member_id, person = candidates[0]
            day = now.date().isoformat()
            key = mark_id(day, shift, member_id)
            if key in marks:
                return ("already" if marks[key]["present"] else "manual_absence"), person["name"]
            row = dict(memberId=member_id, date=day, shift=shift, present=True, source="rfid",
                       readAt=now.isoformat(), tagAtScan=tag)
            inserted = self.db.execute("INSERT OR IGNORE INTO scans VALUES (?,?,?,'pending','')",
                                       (group, key, json.dumps(row))).rowcount
            return ("saved" if inserted else "queued_before"), person["name"]

    def scans(self, status=None, limit=None):
        query = "SELECT group_id,id,value,status,error FROM scans"
        params = []
        if status:
            query += " WHERE status=?"
            params.append(status)
        query += " ORDER BY rowid " + ("ASC" if status == "pending" else "DESC")
        if limit:
            query += " LIMIT ?"
            params.append(limit)
        with self.lock:
            return [(group, key, json.loads(value), status, error)
                    for group, key, value, status, error in self.db.execute(query, params)]

    def counts(self):
        with self.lock:
            return dict(self.db.execute("SELECT status, COUNT(*) FROM scans GROUP BY status"))

    def finish_scan(self, group, key, status, error="", remote=None):
        with self.lock, self.db:
            if remote:
                self.db.execute("INSERT OR REPLACE INTO marks VALUES (?,?,?)", (group, key, json.dumps(remote)))
            self.db.execute("UPDATE scans SET status=?, error=? WHERE group_id=? AND id=?",
                            (status, error, group, key))

    def retry_blocked(self):
        with self.lock, self.db:
            self.db.execute("UPDATE scans SET status='pending', error='' WHERE status='blocked'")

    def backup(self, target):
        target = Path(target)
        temporary = target.with_name(target.name + "." + secrets.token_hex(6) + ".tmp")
        try:
            with self.lock:
                backup = sqlite3.connect(temporary)
                try:
                    self.db.backup(backup)
                finally:
                    backup.close()
                temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)

    def daily_backup(self):
        from modelo import lab_now
        directory = self.directory / "backups"
        directory.mkdir(exist_ok=True)
        target = directory / (lab_now().date().isoformat() + ".sqlite3")
        if not target.exists():
            self.backup(target)
        for old in sorted(directory.glob("????-??-??.sqlite3"), reverse=True)[30:]:
            old.unlink()
