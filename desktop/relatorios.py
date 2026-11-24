from datetime import date, timedelta

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from PIL import Image, ImageDraw, ImageFont

from modelo import GROUPS, HOURS, SHIFTS, days_between, period, report


def export_excel(path, group, data, start, end):
    rows, by_day, people = report(data, start, end)
    book = Workbook()
    book.remove(book.active)

    def sheet(name, columns):
        tab = book.create_sheet(name)
        tab.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(columns))
        tab["A1"] = f"{GROUPS[group]}  |  {start:%d/%m/%Y} a {end:%d/%m/%Y}"
        tab["A1"].font = Font(bold=True, size=15, color="25446E")
        tab.row_dimensions[1].height = 25
        for index, (header, width) in enumerate(columns, 1):
            cell = tab.cell(3, index, header)
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="25446E")
            tab.column_dimensions[get_column_letter(index)].width = width
        tab.freeze_panes = "A4"
        return tab

    def name_text(cell, value):
        cell.value = value
        cell.data_type = "s"

    details = sheet("Presenças", [("Data", 16), ("Turno", 15), ("Integrante", 38),
                                ("Origem", 18), ("Horas", 12), ("Situação", 20)])
    origin = {"legacy": "Histórico", "rfid": "TAG", "manual": "Manual"}
    for row in rows:
        waiting = row.get("source") == "rfid" and "savedAt" not in row
        details.append([date.fromisoformat(row["date"]), SHIFTS[row["shift"]], None,
                        origin.get(row["source"], row["source"]), HOURS, "Pendente" if waiting else "Confirmada"])
        details.cell(details.max_row, 1).number_format = "dd/mm/yyyy"
        name_text(details.cell(details.max_row, 3), row["name"])

    summary = sheet("Resumo por integrante", [("Integrante", 38), ("Dias presentes", 20), ("Turnos", 13),
                                              ("Horas no período", 23), ("Horas acumuladas", 24)])
    for person in people:
        summary.append([None, len(person["days"]), person["shifts"], person["shifts"] * HOURS, person["hours"]])
        name_text(summary.cell(summary.max_row, 1), person["name"])

    daily = sheet("Presenças por dia", [("Data", 16), ("Pessoas presentes", 23)])
    for day in days_between(start, end):
        daily.append([day, len(by_day.get(day, ()))])
        daily.cell(daily.max_row, 1).number_format = "dd/mm/yyyy"
    for sheet_obj in (details, summary, daily):
        sheet_obj.auto_filter.ref = f"A3:{get_column_letter(sheet_obj.max_column)}{sheet_obj.max_row}"

    def chart(sheet_obj, target, title, bar_type):
        if sheet_obj.max_row < 4:
            return
        item = BarChart()
        item.type = bar_type
        item.title = title
        item.legend = None
        item.width = 21
        item.height = min(27, max(10, sheet_obj.max_row * .52)) if bar_type == "bar" else 11
        item.add_data(Reference(sheet_obj, min_col=2, min_row=3, max_row=sheet_obj.max_row), titles_from_data=True)
        item.set_categories(Reference(sheet_obj, min_col=1, min_row=4, max_row=sheet_obj.max_row))
        item.series[0].graphicalProperties.solidFill = "37715C"
        sheet_obj.add_chart(item, target)

    chart(daily, "D3", "Presentes por dia", "col")
    chart(summary, "G3", "Dias presentes por integrante", "bar")
    book.save(path)


def export_png(path, group, data, day):
    _, daily, _ = report(data, day - timedelta(days=13), day)
    _, _, people = report(data, *period(day, "month"))
    image = Image.new("RGB", (940, 525 + max(1, len(people)) * 38), "#eff4f8")
    draw = ImageDraw.Draw(image)
    heading, label, small = (ImageFont.load_default(size=size) for size in (26, 17, 14))
    ink, accent = "#152c46", "#37715c"
    draw.text((28, 21), f"{GROUPS[group]} · Frequência", font=heading, fill=ink)
    draw.text((28, 73), f"Presentes por dia · até {day:%d/%m/%Y}", font=label, fill=ink)
    ceiling = max(1, max((len(count) for count in daily.values()), default=0))
    for index, current in enumerate(days_between(day - timedelta(days=13), day)):
        amount = len(daily.get(current, ()))
        x, height = 48 + index * 64, int(300 * amount / ceiling)
        draw.rectangle((x - 13, 422 - height, x + 13, 422), fill=accent)
        draw.text((x, 403 - height), str(amount), font=small, fill=ink, anchor="mm")
        draw.text((x, 444), current.strftime("%d/%m"), font=small, fill=ink, anchor="mm")
    draw.text((28, 482), f"Dias presentes por integrante · {day:%m/%Y}", font=label, fill=ink)
    if not people:
        draw.text((28, 526), "Sem presenças no mês.", font=small, fill=ink)
    ceiling = max(1, max((len(person["days"]) for person in people), default=0))
    for index, person in enumerate(people):
        amount, y = len(person["days"]), 520 + index * 38
        width = int(410 * amount / ceiling)
        name = person["name"]
        while draw.textlength(name, font=small) > 370:
            name = name[:-2].rstrip("…") + "…"
        draw.text((28, y + 4), name, font=small, fill=ink)
        draw.rectangle((410, y, 410 + width, y + 25), fill=accent)
        draw.text((422 + width, y + 4), str(amount), font=small, fill=ink)
    image.save(path)
