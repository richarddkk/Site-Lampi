import base64
import ctypes
import json
import re
import sys
import time
from ctypes import wintypes
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from modelo import GROUPS, lab_now, model


class CloudError(Exception):
    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


def request(url, body=None, token=None, method=None):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    if isinstance(body, dict):
        headers["Content-Type"] = "application/json"
        body = json.dumps(body).encode()
    elif body is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    try:
        with urlopen(Request(url, data=body, headers=headers, method=method), timeout=8) as response:
            return json.load(response)
    except HTTPError as error:
        try:
            message = json.load(error).get("error", {})
            message = message.get("status") or message.get("message") or "Falha no Firebase"
        except (ValueError, AttributeError):
            message = "Falha no Firebase"
        raise CloudError(message, error.code) from error
    except (URLError, TimeoutError) as error:
        raise CloudError("Sem conexão com o Firebase.") from error


def encode(value):
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, datetime):
        return {"timestampValue": value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [encode(item) for item in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": fields(value)}}
    raise TypeError(type(value).__name__)


def fields(value):
    return {key: encode(item) for key, item in value.items()}


def decode(value):
    if "mapValue" in value:
        return {key: decode(item) for key, item in value["mapValue"].get("fields", {}).items()}
    if "arrayValue" in value:
        return [decode(item) for item in value["arrayValue"].get("values", [])]
    if "integerValue" in value:
        return int(value["integerValue"])
    return next(iter(value.values()))


def data(doc):
    return {key: decode(value) for key, value in (doc or {}).get("fields", {}).items()}


def protect(value, decrypt=False):
    """Protege o token de renovação para o usuário atual do Windows."""
    if sys.platform != "win32":
        return ""
    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("bytes", ctypes.c_void_p)]
    source = base64.b64decode(value) if decrypt else value.encode()
    buffer = ctypes.create_string_buffer(source)
    source_blob = Blob(len(source), ctypes.cast(buffer, ctypes.c_void_p))
    output = Blob()
    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    fn = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    fn.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
                   ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    fn.restype = wintypes.BOOL
    if not fn(ctypes.byref(source_blob), None, None, None, None, 1, ctypes.byref(output)):
        raise OSError("Windows não conseguiu acessar a sessão protegida.")
    try:
        result = ctypes.string_at(output.bytes, output.size)
        return result.decode() if decrypt else base64.b64encode(result).decode()
    finally:
        kernel.LocalFree(output.bytes)


class Firebase:
    def __init__(self, config, store):
        self.store = store
        self.api_key = config["apiKey"]
        self.resource = f"projects/{config['projectId']}/databases/(default)/documents"
        self.base = "https://firestore.googleapis.com/v1/" + self.resource
        self.identity = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
        self.secure_token = "https://securetoken.googleapis.com/v1/token"
        self.uid = self.email = self.id_token = self.role = ""
        self.expiry = 0
        encrypted = store.setting("session_token", "")
        try:
            self.refresh_token = protect(encrypted, decrypt=True) if encrypted else ""
            if self.refresh_token:
                self.email = store.setting("session_email", "")
        except (OSError, ValueError):
            self.refresh_token = ""

    def _set_tokens(self, result, login=False):
        self.id_token = result["idToken" if login else "id_token"]
        self.refresh_token = result["refreshToken" if login else "refresh_token"]
        self.uid = result["localId" if login else "user_id"]
        self.expiry = time.monotonic() + int(result["expiresIn" if login else "expires_in"])

    def login(self, email, password):
        result = request(self.identity + "?" + urlencode({"key": self.api_key}),
                         {"email": email, "password": password, "returnSecureToken": True})
        self._set_tokens(result, login=True)
        self.email = email
        try:
            self.check_role()
            self._save_session()
        except Exception:
            self.logout()
            raise
        return self.role

    def _save_session(self):
        self.store.set_settings({"session_token": protect(self.refresh_token), "session_email": self.email})

    def logout(self):
        self.uid = self.email = self.id_token = self.refresh_token = self.role = ""
        self.expiry = 0
        self.store.set_settings({"session_token": "", "session_email": ""})

    def token(self):
        if self.id_token and time.monotonic() + 90 < self.expiry:
            return self.id_token
        if not self.refresh_token:
            raise CloudError("Entre com a conta Firebase da estação.", 401)
        result = request(self.secure_token + "?" + urlencode({"key": self.api_key}),
                         urlencode({"grant_type": "refresh_token", "refresh_token": self.refresh_token}).encode())
        self._set_tokens(result)
        self._save_session()
        return self.id_token

    def document(self, name):
        try:
            return request(self.base + "/" + name, token=self.token())
        except CloudError as error:
            if error.status == 404:
                return None
            raise

    def check_role(self):
        self.token()
        self.role = data(self.document("lampi_access/" + self.uid)).get("role", "")
        if self.role not in {"admin", "kiosk"}:
            raise CloudError("Conta sem acesso. Confira o cadastro em lampi_access.", 403)

    def commit(self, writes):
        return request(self.base + ":commit", {"writes": writes}, self.token())

    def download(self, group, full=False):
        parent = "attendance_v2/" + group
        roster = data(self.document(parent)).get("members", {})
        legacy = data(self.document("lampi_data/attendance_system")) if group == "lampi" else {}
        cursor = "" if full else self.store.cached(group, "cursor", "")
        query = {"from": [{"collectionId": "marks"}]}
        if cursor:
            query["where"] = {"fieldFilter": {
                "field": {"fieldPath": "savedAt"}, "op": "GREATER_THAN_OR_EQUAL", "value": {"timestampValue": cursor}
            }}
        response = request(self.base + "/" + parent + ":runQuery", {"structuredQuery": query}, self.token())
        marks, times = {}, []
        for item in response:
            if "document" in item:
                doc = item["document"]
                marks[doc["name"].rsplit("/", 1)[1]] = data(doc)
            if "readTime" in item:
                times.append(item["readTime"])
        # The query read time advances monotonically even when it returns no documents.
        self.store.download(group, roster, legacy, marks, times[-1] if times else cursor, replace=not cursor)

    def upload_scan(self, group, key, row):
        root = "attendance_v2/" + group
        path = root + "/marks/" + key
        existing = data(self.document(path))
        if existing:
            status = "sent" if existing.get("present") else "blocked"
            reason = "" if status == "sent" else "Ausência manual mantida no site."
            self.store.finish_scan(group, key, status, reason, existing)
            return
        person = self.store.cached(group, "roster", {}).get(row["memberId"], {})
        if not person.get("active") or person.get("tag") != row["tagAtScan"]:
            self.store.finish_scan(group, key, "blocked", "Cadastro ou TAG mudou. Confira o integrante.")
            return
        mark = {name: row[name] for name in ("memberId", "date", "shift", "present", "source")}
        mark.update(readAt=datetime.fromisoformat(row["readAt"]), actor=self.uid)
        try:
            result = self.commit([{
                "update": {"name": self.resource + "/" + path, "fields": fields(mark)},
                "currentDocument": {"exists": False},
                "updateTransforms": [{"fieldPath": "savedAt", "setToServerValue": "REQUEST_TIME"}],
            }])
        except CloudError as error:
            if error.status in (400, 403, 409, 412):
                # Outra estação ou uma correção manual pode ter gravado entre a leitura e o commit.
                existing = data(self.document(path))
                if existing:
                    status = "sent" if existing.get("present") else "blocked"
                    reason = "" if status == "sent" else "Ausência manual mantida no site."
                    self.store.finish_scan(group, key, status, reason, existing)
                    return
            raise
        self.store.finish_scan(group, key, "sent", remote=dict(
            row, actor=self.uid, savedAt=result["commitTime"]
        ))

    def sync(self, pull=False, full=False):
        self.check_role()
        if pull or full or not all(self.store.cached(group, "cursor", "") for group in GROUPS):
            for group in GROUPS:
                self.download(group, full=full)
        pending = self.store.scans(status="pending", limit=40)
        for group, key, row, _, _ in pending:
            self.upload_scan(group, key, row)

    def save_member(self, group, member_id, name, tag, toggle=False, archive_all=False):
        self.check_role()
        if self.role != "admin":
            raise CloudError("Entre com uma conta administradora para editar integrantes.", 403)
        if not archive_all and (not name.strip() or len(name) > 120 or (tag and not re.fullmatch(r"[0-9]{3,32}", tag))):
            raise CloudError("Informe um nome e, se desejar, uma TAG numérica de 3 a 32 dígitos.")
        root = "attendance_v2/" + group
        for _ in range(4):
            snap = self.document(root)
            roster = data(snap).get("members", {})
            legacy = data(self.document("lampi_data/attendance_system")) if group == "lampi" else {}
            people, _, _ = model(legacy, roster, {})
            if archive_all:
                roster.update({key: dict(person, active=False) for key, person in people.items() if person["active"]})
            else:
                previous = people.get(member_id, {})
                person = dict(previous, name=name.strip(), tag=tag,
                              active=previous.get("active", True), joinDate=previous.get("joinDate", lab_now().date().isoformat()))
                if toggle:
                    person = dict(previous, active=not previous["active"])
                for key, other in people.items():
                    if key == member_id:
                        continue
                    if person["tag"] and person["tag"] == other.get("tag"):
                        raise CloudError("Essa TAG já está vinculada neste grupo.")
                    if person["active"] and other["active"] and person["name"].casefold() == other["name"].casefold():
                        raise CloudError("Já existe um integrante ativo com esse nome.")
                roster[member_id] = person
            try:
                self.commit([{"update": {"name": self.resource + "/" + root, "fields": fields({"members": roster})},
                              "currentDocument": {"updateTime": snap["updateTime"]} if snap else {"exists": False}}])
            except CloudError as error:
                if error.status in (409, 412):
                    continue
                raise
            return
        raise CloudError("O cadastro mudou em outra estação. Tente novamente.")
