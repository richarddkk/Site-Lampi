import { brDate, buildModel, GROUPS, localDate, markId, period, reportData } from "./frequencia-modelo.mjs";
import { drawCharts, exportCharts, exportExcel } from "./frequencia-relatorio.mjs";

const $ = id => document.getElementById(id);
const date = $("date-picker");
const shift = $("shift-picker");
const memberDialog = $("member-dialog");
const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();
const state = {
    group: "lampi", legacy: null, roster: null, marks: null,
    model: buildModel(), draft: new Map(), subscriptions: [], remote: new Map(), connected: false, saving: false
};
const groupDoc = group => db.collection("attendance_v2").doc(group);
const legacyDoc = db.collection("lampi_data").doc("attendance_system");
const slot = () => date.value + "_" + shift.value;

function textElement(tag, value, cssClass) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (cssClass) node.className = cssClass;
    return node;
}

function notice(message, error = false) {
    const node = $("chamada-status");
    node.hidden = !message;
    node.textContent = message;
    node.dataset.error = String(error);
}

function activeMembers() {
    return [...state.model.members.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function confirmedPresent(id) {
    return state.model.records.get(slot() + "_" + id)?.present === true;
}

function renderRows() {
    const all = activeMembers();
    const members = all.filter(person => person.active);
    const list = $("members-list");
    list.replaceChildren();
    let count = 0;
    for (const person of members) {
        const row = textElement("li", "", "member-row");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = state.draft.get(person.id) ?? confirmedPresent(person.id);
        box.disabled = !state.connected || state.saving;
        box.setAttribute("aria-label", "Presença de " + person.name);
        if (box.checked) count++;
        box.addEventListener("change", () => {
            if (box.checked === confirmedPresent(person.id)) state.draft.delete(person.id);
            else state.draft.set(person.id, box.checked);
            $("btn-save").disabled = !state.draft.size;
            $("count-shift").textContent = list.querySelectorAll("input:checked").length + " / " + members.length + " presentes";
        });
        row.append(textElement("strong", person.name), box);
        list.append(row);
    }
    if (!members.length) list.append(textElement("li", state.connected ? "Nenhum integrante ativo neste grupo." : "Carregando chamada…", "empty"));
    $("count-shift").textContent = count + " / " + members.length + " presentes";
    $("btn-save").disabled = !state.connected || !state.draft.size || state.saving;

    const query = $("member-search").value.trim().toLocaleLowerCase("pt-BR");
    const manage = $("manage-members-list");
    manage.replaceChildren();
    for (const member of all) {
        if (!member.active && !$("show-archived").checked) continue;
        if (!member.name.toLocaleLowerCase("pt-BR").includes(query) && !member.tag?.includes(query)) continue;
        const row = textElement("li", "", "member-row");
        const detail = textElement("div", "");
        const hours = state.model.hours.get(member.id) ?? 0;
        detail.append(textElement("strong", member.name),
            textElement("p", hours + " h · " + (member.tag ? "TAG vinculada" : "Sem TAG") + (member.active ? "" : " · Arquivado"), "member-meta"));
        const button = textElement("button", "Editar", "btn btn-green");
        button.type = "button";
        button.addEventListener("click", () => openMember(member));
        row.append(detail, button);
        manage.append(row);
    }
    if (!manage.children.length) manage.append(textElement("li", "Nenhum integrante encontrado.", "empty"));
}

function render() {
    renderRows();
    $("add-member").disabled = !state.connected;
    for (const id of ["export-week", "export-month", "export-charts"]) $(id).disabled = !state.connected;
    const month = drawCharts($("chart-days"), $("chart-people"), state.model, date.value);
    const today = localDate();
    const present = reportData(state.model, today, today).byDay.get(today)?.size ?? 0;
    const visits = [...month.byDay.values()].reduce((sum, people) => sum + people.size, 0);
    const cards = [
        ["Presentes hoje", present],
        ["Presenças no mês", visits],
        ["Média por dia com registro", (month.byDay.size ? visits / month.byDay.size : 0).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })],
        ["Integrantes ativos", activeMembers().filter(member => member.active).length]
    ];
    $("metrics").replaceChildren(...cards.map(([label, value]) => {
        const node = textElement("div", "");
        node.append(textElement("strong", value), textElement("span", label));
        return node;
    }));
    const [start, end] = period(date.value, "month");
    $("report-period").textContent = GROUPS[state.group] + " · Mês de " + brDate(start) + " a " + brDate(end);
}

function refresh() {
    const loaded = state.legacy !== null && state.roster !== null && state.marks !== null;
    state.connected = loaded && [...state.remote.values()].every(Boolean);
    if (loaded) {
        state.model = buildModel(state.legacy, state.roster, state.marks);
        $("connection").textContent = (state.connected ? "Conectado ao Firebase · " : "Aguardando conexão com o Firebase · ") + GROUPS[state.group];
    }
    render();
}

function connect(group) {
    state.subscriptions.forEach(stop => stop());
    state.group = group;
    state.remote = new Map();
    state.legacy = group === "lampi" ? null : {};
    state.roster = null;
    state.marks = null;
    state.model = buildModel();
    state.draft.clear();
    document.querySelectorAll("[data-group]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.group === group)));
    $("connection").textContent = "Carregando " + GROUPS[group] + "…";
    notice("");
    refresh();
    const fail = field => error => {
        state.remote.set(field, false);
        console.error(error);
        $("connection").textContent = "Falha no Firebase. Confira a conexão e a permissão da conta.";
        state.connected = false;
        render();
    };
    const ref = groupDoc(group);
    state.subscriptions = [
        ref.onSnapshot({ includeMetadataChanges: true }, snap => {
            if (snap.metadata.fromCache && state.roster === null) return;
            state.remote.set("roster", !snap.metadata.fromCache);
            state.roster = snap.data()?.members ?? {};
            refresh();
        }, fail("roster")),
        ref.collection("marks").onSnapshot({ includeMetadataChanges: true }, snap => {
            if (snap.metadata.fromCache && state.marks === null) return;
            state.remote.set("marks", !snap.metadata.fromCache);
            state.marks = snap.docs.map(doc => doc.data());
            refresh();
        }, fail("marks"))
    ];
    if (group === "lampi") state.subscriptions.push(legacyDoc.onSnapshot({ includeMetadataChanges: true }, snap => {
        if (snap.metadata.fromCache && state.legacy === null) return;
        state.remote.set("legacy", !snap.metadata.fromCache);
        state.legacy = snap.data() ?? {};
        refresh();
    }, fail("legacy")));
}

let editedMember;
function openMember(member) {
    if (!state.connected) return;
    editedMember = member;
    $("member-title").textContent = member ? "Editar integrante" : "Cadastrar integrante";
    $("member-info").textContent = member
        ? "Entrada: " + brDate(member.joinDate) + " · " + (state.model.hours.get(member.id) ?? 0) + " horas acumuladas"
        : GROUPS[state.group];
    $("member-name").value = member?.name ?? "";
    $("member-tag").value = member?.tag ?? "";
    $("archive-member").hidden = !member;
    $("archive-member").textContent = member?.active ? "Arquivar" : "Reativar";
    $("member-error").textContent = "";
    memberDialog.showModal();
}

async function saveMember(toggleActive) {
    const id = editedMember?.id ?? "m_" + crypto.randomUUID();
    const name = $("member-name").value.trim();
    const tag = $("member-tag").value.trim();
    if (!name || (tag && !/^\d{3,32}$/.test(tag))) {
        $("member-error").textContent = "Informe um nome e, se desejar, uma TAG numérica de 3 a 32 dígitos.";
        return;
    }
    const group = state.group;
    const ref = groupDoc(group);
    $("save-member").disabled = $("archive-member").disabled = true;
    try {
        await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            const legacy = group === "lampi" ? (await tx.get(legacyDoc)).data() ?? {} : {};
            const roster = snap.data()?.members ?? {};
            const people = buildModel(legacy, roster).members;
            const previous = people.get(id);
            const member = {
                name: toggleActive ? previous.name : name,
                tag: toggleActive ? previous.tag : tag,
                active: toggleActive ? !previous.active : (previous?.active ?? true),
                joinDate: previous?.joinDate ?? localDate()
            };
            if (previous?.legacyName) member.legacyName = previous.legacyName;
            for (const other of people.values()) {
                if (other.id === id) continue;
                if (member.active && other.active && other.name.toLocaleLowerCase("pt-BR") === member.name.toLocaleLowerCase("pt-BR")) throw new Error("Já existe um integrante ativo com esse nome.");
                if (member.tag && other.tag === member.tag) throw new Error("Essa TAG já está vinculada neste grupo.");
            }
            tx.set(ref, { members: { ...roster, [id]: member } });
        });
        memberDialog.close();
        notice("Cadastro atualizado.");
    } catch (error) {
        $("member-error").textContent = error.code ? "O Firebase não confirmou a alteração. Confira a conexão e as permissões." : error.message;
    } finally {
        $("save-member").disabled = $("archive-member").disabled = false;
    }
}

if (await window.lampiAdminReady) {
    date.value = localDate();
    let previousDate = date.value;
    let previousShift = shift.value;
    const changeSlot = () => {
        if (!date.value || (state.draft.size && !confirm("Descartar as alterações de chamada que ainda não foram salvas?"))) {
            date.value = previousDate;
            shift.value = previousShift;
            return;
        }
        previousDate = date.value;
        previousShift = shift.value;
        state.draft.clear();
        notice("");
        render();
    };
    date.addEventListener("change", changeSlot);
    shift.addEventListener("change", changeSlot);
    $("logout").addEventListener("click", () => window.logout());
    document.querySelectorAll("[data-group]").forEach(button => button.addEventListener("click", () => {
        if (state.saving || state.group === button.dataset.group) return;
        if (state.draft.size && !confirm("Descartar as alterações de chamada que ainda não foram salvas?")) return;
        connect(button.dataset.group);
    }));
    $("member-search").addEventListener("input", renderRows);
    $("show-archived").addEventListener("change", renderRows);
    $("add-member").addEventListener("click", () => openMember(null));
    $("close-member").addEventListener("click", () => memberDialog.close());
    $("member-tag").addEventListener("keydown", event => {
        if (event.key === "Enter") event.preventDefault();
    });
    $("member-form").addEventListener("submit", event => { event.preventDefault(); void saveMember(false); });
    $("archive-member").addEventListener("click", () => { void saveMember(true); });
    $("btn-save").addEventListener("click", async () => {
        state.saving = true;
        date.disabled = shift.disabled = true;
        renderRows();
        try {
            const batch = db.batch();
            const marks = groupDoc(state.group).collection("marks");
            for (const [id, present] of state.draft) {
                batch.set(marks.doc(markId(date.value, shift.value, id)), {
                    memberId: id, date: date.value, shift: shift.value, present,
                    source: "manual", actor: auth.currentUser.uid, savedAt: serverTime()
                });
            }
            await batch.commit();
            state.draft.clear();
            notice("Chamada salva no Firebase.");
        } catch (error) {
            console.error(error);
            notice("Não foi possível salvar. As alterações continuam marcadas para tentar novamente.", true);
        } finally {
            state.saving = false;
            date.disabled = shift.disabled = false;
            renderRows();
        }
    });
    for (const kind of ["week", "month"]) {
        $("export-" + kind).addEventListener("click", () => exportExcel(state.group, state.model, date.value, kind).catch(error => {
            console.error(error);
            notice("Não foi possível gerar a planilha.", true);
        }));
    }
    $("export-charts").addEventListener("click", () => exportCharts(state.group, date.value, $("chart-days"), $("chart-people")));
    connect("lampi");
}
