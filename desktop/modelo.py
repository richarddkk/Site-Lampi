from base64 import urlsafe_b64encode
from calendar import monthrange
from datetime import date, datetime, timedelta, timezone

GROUPS = {"lampi": "LAMPI", "gcomph": "GCOMPH"}
SHIFTS = {"manha": "Manhã", "tarde": "Tarde", "noite": "Noite"}
HOURS = 4


def lab_now():
    return datetime.now(timezone(timedelta(hours=-3)))


def mark_id(day, shift, member_id):
    return f"{day}_{shift}_{member_id}"


def legacy_id(name):
    return "l_" + urlsafe_b64encode(name.encode()).decode().rstrip("=")


def period(day, mode):
    if mode == "week":
        start = day - timedelta(days=day.weekday())
        return start, start + timedelta(days=6)
    return day.replace(day=1), day.replace(day=monthrange(day.year, day.month)[1])


def days_between(start, end):
    for delta in range((end - start).days + 1):
        yield start + timedelta(days=delta)


def model(legacy, roster, marks):
    members, records, hours = {}, {}, {}
    active = set(legacy.get("members", []))
    details = legacy.get("member_details", {})

    def ensure(name):
        member_id = legacy_id(name)
        return member_id, members.setdefault(member_id, {
            "name": name, "legacyName": name, "active": name in active, "tag": "",
            "joinDate": details.get(name, {}).get("joinDate", ""),
        })

    for name in active.union(details):
        ensure(name)
    for key, row in sorted(legacy.get("attendance", {}).items()):
        day, _, shift = key.partition("_")
        if shift not in SHIFTS:
            continue
        try:
            date.fromisoformat(day)
        except ValueError:
            continue
        for name, present in (row or {}).items():
            if present is not True:
                continue
            member_id, member = ensure(name)
            member["joinDate"] = member["joinDate"] or day
            records[mark_id(day, shift, member_id)] = {
                "date": day, "shift": shift, "memberId": member_id, "present": True, "source": "legacy"
            }
    members.update(roster)
    records.update(marks)
    for row in records.values():
        if row["present"]:
            member_id = row["memberId"]
            hours[member_id] = hours.get(member_id, 0) + HOURS
    return members, records, hours


def report(data, start, end):
    members, records, hours = data
    by_day, summary, rows = {}, {}, []
    for row in records.values():
        if not row["present"] or not start.isoformat() <= row["date"] <= end.isoformat():
            continue
        member_id = row["memberId"]
        day = date.fromisoformat(row["date"])
        name = members.get(member_id, {}).get("name", member_id)
        by_day.setdefault(day, set()).add(member_id)
        person = summary.setdefault(member_id, {"name": name, "days": set(), "shifts": 0, "hours": hours[member_id]})
        person["days"].add(day)
        person["shifts"] += 1
        rows.append(dict(row, name=name))
    rows.sort(key=lambda row: (row["date"], list(SHIFTS).index(row["shift"]), row["name"].casefold()))
    people = sorted(summary.values(), key=lambda person: (-len(person["days"]), person["name"].casefold()))
    return rows, by_day, people
