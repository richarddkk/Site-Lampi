import { addDays, brDate, GROUPS, HOURS_PER_SHIFT, period, reportData, SHIFTS } from "./frequencia-modelo.mjs";

export function drawCharts(canvas, people, model, date) {
    const month = reportData(model, ...period(date, "month"));
    const recent = Array.from({ length: 14 }, (_, i) => {
        const day = addDays(date, i - 13);
        const count = reportData(model, day, day).byDay.get(day)?.size ?? 0;
        return [brDate(day).slice(0, 5), count];
    });
    const color = "#25446e";
    let ctx = canvas.getContext("2d");
    canvas.width = 700;
    canvas.height = 290;
    ctx.fillStyle = "#f3f6fb";
    ctx.fillRect(0, 0, 700, 290);
    ctx.font = "bold 14px system-ui";
    ctx.textAlign = "center";
    const max = Math.max(1, ...recent.map(([, count]) => count));
    recent.forEach(([day, count], index) => {
        const x = 27 + index * 49;
        const height = count / max * 197;
        ctx.fillStyle = color;
        ctx.fillRect(x - 12, 240 - height, 24, Math.max(2, height));
        ctx.fillText(String(count), x, 231 - height);
        ctx.fillStyle = "#475569";
        ctx.fillText(day, x, 264);
    });
    canvas.setAttribute("aria-label", recent.map(([day, count]) => day + ": " + count).join(" · "));

    people.width = 700;
    people.height = Math.max(290, 35 * month.summaries.length + 22);
    ctx = people.getContext("2d");
    ctx.fillStyle = "#f3f6fb";
    ctx.fillRect(0, 0, people.width, people.height);
    ctx.font = "16px system-ui";
    ctx.fillStyle = color;
    if (!month.summaries.length) ctx.fillText("Sem presenças neste mês.", 22, 70);
    const mostDays = Math.max(1, ...month.summaries.map(item => item.days.size));
    month.summaries.forEach(({ name, days }, index) => {
        const y = 28 + index * 35;
        const width = 390 * days.size / mostDays;
        ctx.fillText(name, 12, y + 4, 231);
        ctx.fillRect(255, y - 13, width, 21);
        ctx.fillText(String(days.size), 265 + width, y + 4);
    });
    people.setAttribute("aria-label", month.summaries.map(item => item.name + ": " + item.days.size).join(" · ") || "Sem presenças neste mês");
    return month;
}

function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCharts(group, date, daily, monthly) {
    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = daily.height + monthly.height + 160;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f3f6fb";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#25446e";
    ctx.font = "bold 26px system-ui";
    ctx.fillText(GROUPS[group] + " · Frequência", 30, 41);
    ctx.font = "18px system-ui";
    ctx.fillText("Presentes por dia · até " + brDate(date), 30, 81);
    ctx.drawImage(daily, 30, 91);
    ctx.fillText("Dias presentes por integrante · " + date.slice(0, 7), 30, 117 + daily.height);
    ctx.drawImage(monthly, 30, 128 + daily.height);
    canvas.toBlob(blob => {
        if (blob) download(blob, "graficos-" + group + "-" + date + ".png");
    });
}

export async function exportExcel(group, model, date, kind) {
    const [start, end] = period(date, kind);
    const { rows, summaries, byDay } = reportData(model, start, end);
    const book = new window.ExcelJS.Workbook();
    const dateValue = value => new Date(value + "T00:00:00Z");
    function sheet(name, columns) {
        const tab = book.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
        tab.mergeCells(1, 1, 1, columns.length);
        tab.getCell("A1").value = GROUPS[group] + "  |  " + brDate(start) + " a " + brDate(end);
        tab.getCell("A1").font = { bold: true, size: 15, color: { argb: "FF25446E" } };
        tab.getRow(1).height = 24;
        columns.forEach((column, index) => { tab.getColumn(index + 1).width = column[1]; });
        const header = tab.getRow(3);
        header.values = columns.map(column => column[0]);
        header.eachCell(cell => {
            cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF25446E" } };
        });
        tab.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: columns.length } };
        return tab;
    }
    const details = sheet("Presenças", [["Data", 15], ["Turno", 14], ["Integrante", 36], ["Origem", 18], ["Horas", 12]]);
    const origins = { legacy: "Histórico", manual: "Manual", rfid: "TAG" };
    rows.forEach(row => details.addRow([dateValue(row.date), SHIFTS[row.shift], row.name, origins[row.source] ?? row.source, HOURS_PER_SHIFT]));
    details.getColumn(1).numFmt = "dd/mm/yyyy";
    const summary = sheet("Resumo por integrante", [["Integrante", 36], ["Dias presentes", 19], ["Turnos", 13], ["Horas no período", 21], ["Horas acumuladas", 22]]);
    summaries.forEach(row => summary.addRow([row.name, row.days.size, row.shifts, row.shifts * HOURS_PER_SHIFT, row.totalHours]));
    const daily = sheet("Presenças por dia", [["Data", 15], ["Pessoas presentes", 22]]);
    for (let day = start; day <= end; day = addDays(day, 1)) daily.addRow([dateValue(day), byDay.get(day)?.size ?? 0]);
    daily.getColumn(1).numFmt = "dd/mm/yyyy";
    const bytes = await book.xlsx.writeBuffer();
    download(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "frequencia-" + group + "-" + start + "-" + end + ".xlsx");
}
