export const SHIFTS = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
export const HOURS_PER_SHIFT = 4;
export const GROUPS = { lampi: "LAMPI", gcomph: "GCOMPH" };
const dateFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Fortaleza" });

export function localDate() {
    return dateFormat.format(new Date());
}

export function addDays(date, days) {
    const value = new Date(date + "T00:00:00Z");
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
}

export function period(date, kind) {
    const value = new Date(date + "T00:00:00Z");
    if (kind === "week") {
        const start = addDays(date, -((value.getUTCDay() + 6) % 7));
        return [start, addDays(start, 6)];
    }
    value.setUTCMonth(value.getUTCMonth() + 1, 0);
    return [date.slice(0, 7) + "-01", value.toISOString().slice(0, 10)];
}

export function brDate(date) {
    return date ? date.split("-").reverse().join("/") : "—";
}

export function legacyId(name) {
    const bytes = new TextEncoder().encode(name);
    return "l_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function markId(date, shift, memberId) {
    return [date, shift, memberId].join("_");
}

export function buildModel(legacy = {}, roster = {}, marks = []) {
    const members = new Map();
    const records = new Map();
    const active = new Set(legacy.members ?? []);
    const details = legacy.member_details ?? {};
    function ensure(name) {
        const id = legacyId(name);
        if (!members.has(id)) {
            members.set(id, { id, name, legacyName: name, active: active.has(name), tag: "", joinDate: Object.hasOwn(details, name) ? details[name]?.joinDate ?? "" : "" });
        }
        return members.get(id);
    }
    for (const name of new Set([...active, ...Object.keys(details)])) ensure(name);
    for (const [key, row] of Object.entries(legacy.attendance ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
        const [date, shift] = key.split("_");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Object.hasOwn(SHIFTS, shift)) continue;
        for (const [name, present] of Object.entries(row ?? {})) {
            if (present !== true) continue;
            const member = ensure(name);
            member.joinDate ||= date;
            records.set(markId(date, shift, member.id), { date, shift, memberId: member.id, present, source: "legacy" });
        }
    }
    for (const [id, data] of Object.entries(roster)) members.set(id, { id, ...data });
    for (const mark of marks) records.set(markId(mark.date, mark.shift, mark.memberId), mark);
    const hours = new Map();
    for (const mark of records.values()) {
        if (mark.present) hours.set(mark.memberId, (hours.get(mark.memberId) ?? 0) + HOURS_PER_SHIFT);
    }
    return { members, records, hours };
}

export function reportData(model, start, end) {
    const byDay = new Map();
    const byMember = new Map();
    const rows = [];
    for (const mark of model.records.values()) {
        if (!mark.present || mark.date < start || mark.date > end) continue;
        const name = model.members.get(mark.memberId)?.name ?? mark.memberId;
        const ids = byDay.get(mark.date) ?? new Set();
        ids.add(mark.memberId);
        byDay.set(mark.date, ids);
        const summary = byMember.get(mark.memberId) ?? { name, days: new Set(), shifts: 0, totalHours: model.hours.get(mark.memberId) };
        summary.days.add(mark.date);
        summary.shifts++;
        byMember.set(mark.memberId, summary);
        rows.push({ ...mark, name });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || Object.keys(SHIFTS).indexOf(a.shift) - Object.keys(SHIFTS).indexOf(b.shift) || a.name.localeCompare(b.name, "pt-BR"));
    return { rows, byDay, summaries: [...byMember.values()].sort((a, b) => b.days.size - a.days.size || a.name.localeCompare(b.name, "pt-BR")) };
}
