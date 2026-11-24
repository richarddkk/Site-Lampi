import json
import os
import re
import sqlite3
import subprocess
import sys
import time
import tkinter as tk
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from tkinter import filedialog, messagebox, simpledialog, ttk
from uuid import uuid4

from firebase_client import CloudError, Firebase
from local import DEFAULTS, LocalStore
from modelo import GROUPS, SHIFTS, days_between, lab_now, period, report

BASE = Path(__file__).resolve().parent
DARK = {"bg": "#131d2c", "panel": "#1d2a3d", "text": "#eff5fb", "muted": "#b4c3d3", "line": "#3b5068", "accent": "#a3e3bc", "error": "#ffb697"}
LIGHT = {"bg": "#eef3f8", "panel": "#ffffff", "text": "#173150", "muted": "#49617a", "line": "#cad6e1", "accent": "#2c714f", "error": "#a53035"}
STATUS = {"pending": "Pendente", "sent": "Sincronizada", "blocked": "Revisar"}


class FrequencyApp:
    def __init__(self, root, store, cloud):
        self.root, self.store, self.cloud = root, store, cloud
        self.config = {key: store.setting(key, value) for key, value in DEFAULTS.items()}
        self.group = self.config["group"]
        self.style = ttk.Style(root)
        self.style.theme_use("clam")
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.job = None
        self.job_done = None
        self.last_pull = 0
        self.sync_requested = False
        self.panel = None
        self.notice = ("Aguardando leitura", "muted")
        self.connection = tk.StringVar(value="Conecte a conta Firebase para sincronizar.")
        self.clock = tk.StringVar()
        self.root.minsize(760, 570)
        self.root.geometry("1000x720")
        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.apply_theme()
        self.render_kiosk()
        self.tick()
        try:
            self.store.daily_backup()
        except (OSError, sqlite3.Error):
            self.connection.set("O backup automático falhou. Confira a pasta de dados.")
        self.root.after(500, self.poll_sync)
        self.root.after(60000, self.backup_tick)

    def apply_theme(self):
        self.colors = DARK if self.config["theme"] == "dark" else LIGHT
        c = self.colors
        self.root.configure(background=c["bg"])
        self.style.configure(".", background=c["bg"], foreground=c["text"], font=("Segoe UI", 10))
        self.style.configure("TFrame", background=c["bg"])
        self.style.configure("Panel.TFrame", background=c["panel"])
        self.style.configure("TLabel", background=c["bg"], foreground=c["text"])
        self.style.configure("Muted.TLabel", foreground=c["muted"])
        self.style.configure("Panel.TLabel", background=c["panel"], foreground=c["text"])
        self.style.configure("PanelMuted.TLabel", background=c["panel"], foreground=c["muted"])
        self.style.configure("Title.TLabel", font=("Segoe UI", 28, "bold"), foreground=c["text"])
        self.style.configure("Section.TLabel", font=("Segoe UI", 15, "bold"), foreground=c["text"])
        self.style.configure("Badge.TLabel", background=c["panel"], foreground=c["accent"], font=("Segoe UI", 21, "bold"))
        self.style.configure("TButton", background=c["panel"], foreground=c["text"], padding=(11, 7), bordercolor=c["line"])
        self.style.configure("Primary.TButton", background=c["accent"], foreground="#14271e" if c is DARK else "white", font=("Segoe UI", 10, "bold"))
        self.style.map("TButton", background=[("active", c["line"]), ("disabled", c["panel"])],
                       foreground=[("active", c["text"]), ("disabled", c["muted"])])
        self.style.configure("TEntry", fieldbackground=c["panel"], foreground=c["text"], insertcolor=c["text"], padding=6)
        self.style.configure("TCombobox", fieldbackground=c["panel"], foreground=c["text"], padding=6)
        self.style.map("TCombobox", fieldbackground=[("readonly", c["panel"])], foreground=[("readonly", c["text"])])
        self.style.configure("TNotebook", background=c["bg"], borderwidth=0)
        self.style.configure("TNotebook.Tab", padding=(12, 8), background=c["panel"])
        self.style.map("TNotebook.Tab", foreground=[("selected", c["accent"])], background=[("selected", c["line"])])
        self.style.configure("Treeview", background=c["panel"], fieldbackground=c["panel"], foreground=c["text"], rowheight=28)
        self.style.configure("Treeview.Heading", background=c["line"], foreground=c["text"], padding=(6, 5))
        self.style.map("Treeview", background=[("selected", c["line"])], foreground=[("selected", c["text"])])

    def render_kiosk(self):
        r = self.root
        for widget in r.winfo_children():
            if isinstance(widget, ttk.Frame):
                widget.destroy()
        r.title(self.config["title"])
        shell = ttk.Frame(r, padding=(28, 20))
        shell.pack(fill="both", expand=True)
        bar = ttk.Frame(shell)
        bar.pack(fill="x")
        ttk.Label(bar, text=self.config["title"], style="Section.TLabel").pack(side="left")
        ttk.Button(bar, text="Tema " + ("claro" if self.colors is DARK else "escuro"), command=self.toggle_theme).pack(side="right")
        ttk.Button(bar, text="Painel ADM", command=self.open_admin).pack(side="right", padx=7)
        hero = ttk.Frame(shell, style="Panel.TFrame", padding=(23, 20))
        hero.pack(fill="x", pady=(17, 12))
        ttk.Label(hero, text=self.config["lab"], style="Panel.TLabel", font=("Segoe UI", 26, "bold")).pack()
        subtitle = " · ".join(text for text in [self.config["campus"], self.config["teacher"]] if text)
        ttk.Label(hero, text=subtitle, style="PanelMuted.TLabel").pack()
        ttk.Label(hero, textvariable=self.clock, style="PanelMuted.TLabel").pack(pady=(4, 12))
        ttk.Label(hero, text=GROUPS[self.config["group"]] + "   /   " + SHIFTS[self.config["shift"]],
                  style="Panel.TLabel", font=("Segoe UI", 12, "bold")).pack()
        ttk.Label(hero, text="Aproxime sua TAG do leitor", style="Panel.TLabel", font=("Segoe UI", 17)).pack(pady=(10, 6))
        self.entry = ttk.Entry(hero, width=23, show="•", justify="center", font=("Consolas", 12))
        self.entry.pack()
        self.entry.bind("<Return>", self.register)
        self.entry.bind("<KP_Enter>", self.register)
        self.entry.bind("<FocusOut>", lambda event: event.widget.delete(0, "end"))
        self.entry.bind("<KeyPress>", self.reader_key)
        self.last_key = 0
        self.feedback = tk.Label(hero, text=self.notice[0], bg=self.colors["panel"], fg=self.colors[self.notice[1]],
                                 font=("Segoe UI", 12, "bold"))
        self.feedback.pack(pady=(8, 0))
        recent = ttk.Frame(shell)
        recent.pack(fill="both", expand=True)
        recent_header = ttk.Frame(recent)
        recent_header.pack(fill="x")
        ttk.Label(recent_header, text="Últimos registros desta estação", style="Section.TLabel").pack(side="left")
        self.today_count = ttk.Label(recent_header, style="Muted.TLabel")
        self.today_count.pack(side="right")
        self.recent = self.table(recent, ["Horário", "Integrante", "Turno", "Situação"], [100, 300, 110, 150], height=4)
        ttk.Label(shell, textvariable=self.connection, style="Muted.TLabel", wraplength=800).pack(anchor="w", pady=(8, 0))
        self.render_recent()
        self.entry.focus_set()

    def toggle_theme(self):
        self.config["theme"] = "light" if self.colors is DARK else "dark"
        self.store.set_settings({"theme": self.config["theme"]})
        self.apply_theme()
        self.render_kiosk()

    def tick(self):
        self.clock.set(lab_now().strftime("%d/%m/%Y · %H:%M:%S"))
        self.root.after(1000, self.tick)

    def backup_tick(self):
        try:
            self.store.daily_backup()
        except (OSError, sqlite3.Error):
            self.connection.set("O backup automático falhou. Confira a pasta de dados.")
        self.root.after(60000, self.backup_tick)

    def close(self):
        if self.job and not self.job.done():
            if not messagebox.askyesno("Sair", "Há uma operação em andamento. Deseja fechar?"):
                return
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.root.destroy()

    def reader_key(self, event):
        if event.keysym in {"Return", "KP_Enter"}:
            return
        if event.char and event.char not in "0123456789":
            return "break"
        if not event.char:
            return
        now = time.monotonic()
        if now - self.last_key > 0.7:
            self.entry.delete(0, "end")
        self.last_key = now
        if len(self.entry.get()) >= 32:
            return "break"

    def register(self, event=None):
        tag = self.entry.get().strip()
        self.entry.delete(0, "end")
        if not re.fullmatch(r"[0-9]{3,32}", tag):
            return "break"
        now = lab_now()
        try:
            status, name = self.store.scan(self.config["group"], self.config["shift"], tag, now)
        except Exception:
            self.show_feedback("Não foi possível salvar. Confira a pasta de dados.", "error")
            return "break"
        options = {
            "saved": (f"{name} · presença salva neste computador", "accent"),
            "already": (f"{name} · presença já registrada neste turno", "muted"),
            "manual_absence": (f"{name} · ausência registrada no site. Consulte o administrador.", "error"),
            "unknown": ("TAG sem vínculo neste grupo", "error"),
            "duplicate_tag": ("TAG vinculada a mais de um integrante. Consulte o administrador.", "error"),
            "queued_before": (f"{name} · leitura anterior aguarda revisão", "error"),
        }
        self.show_feedback(*options[status])
        if status == "saved":
            self.sync_requested = True
            self.render_recent()
            self.render_admin()
        return "break"

    def show_feedback(self, text, color):
        self.notice = (text, color)
        self.feedback.configure(text=text, fg=self.colors[color])

    def table(self, parent, labels, widths, height=11):
        frame = ttk.Frame(parent)
        frame.pack(fill="both", expand=True, pady=(5, 0))
        cols = [f"c{index}" for index in range(len(labels))]
        tree = ttk.Treeview(frame, columns=cols, show="headings", selectmode="browse", height=height)
        scroll = ttk.Scrollbar(frame, orient="vertical", command=tree.yview)
        scroll.pack(side="right", fill="y")
        tree.configure(yscrollcommand=scroll.set)
        tree.pack(side="left", fill="both", expand=True)
        for column, label, width in zip(cols, labels, widths):
            tree.heading(column, text=label, anchor="w")
            tree.column(column, width=width, minwidth=54)
        return tree

    def render_recent(self):
        self.recent.delete(*self.recent.get_children())
        group = self.config["group"]
        cached = self.store.data(group)
        members, _, _ = cached
        today = lab_now().date()
        _, by_day, _ = report(cached, today, today)
        self.today_count.configure(text=f"Presentes hoje: {len(by_day.get(today, ()))}")
        for scan_group, _, row, state, _ in self.store.scans(limit=50):
            if scan_group == group and row["date"] == today.isoformat():
                self.recent.insert("", "end", values=(row["readAt"][11:19], members.get(row["memberId"], {}).get("name", "Integrante"),
                                                       SHIFTS[row["shift"]], STATUS[state]))
                if len(self.recent.get_children()) >= 10:
                    break

    def run(self, task, callback=None, sync=False):
        if self.job:
            if not sync:
                messagebox.showinfo("Aguarde", "A estação está sincronizando. Tente novamente em alguns segundos.", parent=self.panel or self.root)
            return False
        self.job = self.executor.submit(task)
        self.job_done = callback
        if sync:
            self.connection.set("Sincronizando com o Firebase…")
        return True

    def poll_sync(self):
        if self.job and self.job.done():
            task, callback = self.job, self.job_done
            self.job = self.job_done = None
            try:
                task.result()
            except Exception as error:
                if callback:
                    callback(error)
                else:
                    self.sync_status(error)
            else:
                if callback:
                    callback(None)
                else:
                    self.sync_status()
            self.render_recent()
            self.render_admin()
        if not self.job and self.cloud.refresh_token:
            pull = time.monotonic() - self.last_pull > 55
            if pull or self.sync_requested:
                self.last_pull = time.monotonic() if pull else self.last_pull
                self.sync_requested = False
                self.run(lambda: self.cloud.sync(pull=pull), sync=True)
        self.root.after(350, self.poll_sync)

    def sync_status(self, error=None):
        counts = self.store.counts()
        total = f"{counts.get('pending', 0)} pendente(s), {counts.get('blocked', 0)} para revisão"
        if error:
            self.connection.set(f"Sincronização interrompida · {self.error_text(error)} · {total}.")
        else:
            self.connection.set(f"Firebase conectado · {total}.")

    @staticmethod
    def error_text(error):
        standard = {
            "INVALID_LOGIN_CREDENTIALS": "E-mail ou senha inválida.",
            "INVALID_PASSWORD": "E-mail ou senha inválida.",
            "PERMISSION_DENIED": "Permissão negada. Confira a conta e as regras do Firestore.",
            "API_KEY_HTTP_REFERRER_BLOCKED": "A chave de API está restrita ao navegador.",
            "CONFIGURATION_NOT_FOUND": "Ative o login por e-mail no Firebase Authentication.",
        }
        return standard.get(str(error), str(error) if isinstance(error, CloudError) else "Não foi possível concluir a ação.")

    def open_admin(self):
        if self.panel and self.panel.winfo_exists():
            self.panel.lift()
            return
        if not self.store.setting("admin_pin"):
            pin = simpledialog.askstring("Primeiro acesso", "Crie uma senha local para o painel (8 ou mais caracteres).",
                                         show="•", parent=self.root)
            if not pin:
                return
            if len(pin) < 8:
                messagebox.showerror("Painel ADM", "Use pelo menos 8 caracteres.", parent=self.root)
                return
            confirm = simpledialog.askstring("Confirmar senha", "Digite a senha novamente.", show="•", parent=self.root)
            if pin != confirm:
                messagebox.showerror("Painel ADM", "As senhas não coincidem.", parent=self.root)
                return
            self.store.set_pin(pin)
        else:
            pin = simpledialog.askstring("Painel ADM", "Senha local do painel", show="•", parent=self.root)
            if not pin:
                return
            if not self.store.pin_matches(pin):
                messagebox.showerror("Painel ADM", "Senha incorreta.", parent=self.root)
                return
        self.create_admin()

    def create_admin(self):
        self.panel = tk.Toplevel(self.root)
        self.panel.title("Painel de administrador")
        self.panel.geometry("1050x730")
        self.panel.minsize(880, 640)
        self.panel.configure(bg=self.colors["bg"])
        self.panel.protocol("WM_DELETE_WINDOW", self.close_admin)
        shell = ttk.Frame(self.panel, padding=(20, 13))
        shell.pack(fill="both", expand=True)
        bar = ttk.Frame(shell)
        bar.pack(fill="x", pady=(0, 10))
        ttk.Label(bar, text="Painel de administrador", style="Section.TLabel").pack(side="left")
        self.admin_group = tk.StringVar(value=GROUPS[self.config["group"]])
        groups = ttk.Combobox(bar, state="readonly", textvariable=self.admin_group, values=list(GROUPS.values()), width=11)
        groups.pack(side="right")
        groups.bind("<<ComboboxSelected>>", lambda event: self.switch_admin_group())
        self.group = self.config["group"]
        self.tabs = ttk.Notebook(shell)
        self.tabs.pack(fill="both", expand=True)
        overview, people, history, settings, tools = [ttk.Frame(self.tabs, padding=10) for _ in range(5)]
        for frame, title in zip((overview, people, history, settings, tools),
                                ("Visão geral", "Integrantes", "Consultar frequência", "Configurações", "Ferramentas")):
            self.tabs.add(frame, text=title)
        self.build_overview(overview)
        self.build_people(people)
        self.build_history(history)
        self.build_settings(settings)
        self.build_tools(tools)
        self.render_admin()

    def close_admin(self):
        self.panel.destroy()
        self.panel = None
        self.entry.focus_set()

    def switch_admin_group(self):
        self.group = next(group for group, label in GROUPS.items() if label == self.admin_group.get())
        self.render_admin()

    def build_overview(self, frame):
        cards = ttk.Frame(frame)
        cards.pack(fill="x")
        self.metrics = []
        for index, caption in enumerate(("Presentes hoje", "Presenças no mês", "Média por dia com registro", "Integrantes ativos")):
            cards.columnconfigure(index, weight=1, uniform="cards")
            card = ttk.Frame(cards, style="Panel.TFrame", padding=11)
            card.grid(row=0, column=index, padx=3, sticky="nsew")
            value = ttk.Label(card, text="0", style="Badge.TLabel")
            value.pack(anchor="w")
            ttk.Label(card, text=caption, style="PanelMuted.TLabel").pack(anchor="w")
            self.metrics.append(value)
        charts = ttk.Frame(frame)
        charts.pack(fill="both", expand=True, pady=(14, 0))
        self.charts = []
        for i, title in enumerate(("Presentes por dia · últimos 14 dias", "Dias presentes por integrante · este mês")):
            charts.columnconfigure(i, weight=1, uniform="charts")
            charts.rowconfigure(0, weight=1)
            block = ttk.Frame(charts, style="Panel.TFrame", padding=10)
            block.grid(row=0, column=i, sticky="nsew", padx=3)
            ttk.Label(block, text=title, style="Panel.TLabel", font=("Segoe UI", 11, "bold")).pack(anchor="w")
            canvas = tk.Canvas(block, bg=self.colors["panel"], highlightthickness=0, width=280, height=260)
            if i == 1:
                scrollbar = ttk.Scrollbar(block, orient="vertical", command=canvas.yview)
                scrollbar.pack(side="right", fill="y")
                canvas.configure(yscrollcommand=scrollbar.set)
            canvas.pack(fill="both", expand=True, pady=(8, 0))
            canvas.bind("<Configure>", lambda event: self.draw_charts())
            self.charts.append(canvas)

    def build_people(self, frame):
        row = ttk.Frame(frame)
        row.pack(fill="x")
        self.member_filter = tk.StringVar()
        search = ttk.Entry(row, textvariable=self.member_filter)
        search.pack(side="left", fill="x", expand=True)
        search.bind("<KeyRelease>", lambda event: self.render_people())
        self.show_archived = tk.BooleanVar()
        ttk.Checkbutton(row, text="Mostrar arquivados", variable=self.show_archived, command=self.render_people).pack(side="left", padx=8)
        controls = ttk.Frame(frame)
        controls.pack(side="bottom", fill="x", pady=(10, 0))
        ttk.Button(controls, text="+ Cadastrar integrante", style="Primary.TButton", command=self.member_window).pack(side="left")
        ttk.Button(controls, text="Editar selecionado", command=lambda: self.member_window(self.selected_member())).pack(side="left", padx=7)
        ttk.Button(controls, text="Arquivar / reativar", command=self.toggle_member).pack(side="left")
        self.people_table = self.table(frame, ["Integrante", "TAG", "Horas acumuladas", "Situação"], [285, 150, 120, 110])

    def build_history(self, frame):
        filter_row = ttk.Frame(frame)
        filter_row.pack(fill="x")
        start, end = period(lab_now().date(), "month")
        self.from_date = tk.StringVar(value=start.isoformat())
        self.to_date = tk.StringVar(value=end.isoformat())
        self.report_name = tk.StringVar()
        for label, variable, width in [("De (aaaa-mm-dd)", self.from_date, 14),
                                       ("Até (aaaa-mm-dd)", self.to_date, 14), ("Nome", self.report_name, 23)]:
            entry = ttk.Frame(filter_row)
            entry.pack(side="left", padx=(0, 8))
            ttk.Label(entry, text=label).pack(anchor="w")
            ttk.Entry(entry, textvariable=variable, width=width).pack()
        ttk.Button(filter_row, text="Consultar", command=self.render_history).pack(side="left", anchor="s")
        ttk.Button(filter_row, text="Exportar consulta", command=lambda: self.export("custom")).pack(side="left", padx=8, anchor="s")
        self.history_msg = ttk.Label(frame, style="Muted.TLabel")
        self.history_msg.pack(anchor="w", pady=(8, 0))
        self.history = self.table(frame, ["Data", "Turno", "Integrante", "Origem", "Horas"], [108, 110, 300, 100, 70])

    def build_settings(self, frame):
        self.settings_vars = {}
        for key, label in [("title", "Nome do sistema"), ("lab", "Nome do laboratório"), ("campus", "Campus"), ("teacher", "Professor(a) responsável")]:
            ttk.Label(frame, text=label).pack(anchor="w", pady=(6, 2))
            variable = tk.StringVar(value=self.config[key])
            self.settings_vars[key] = variable
            ttk.Entry(frame, textvariable=variable).pack(fill="x")
        for key, label, values in [("group", "Grupo da estação de leitura", GROUPS), ("shift", "Turno da estação de leitura", SHIFTS)]:
            ttk.Label(frame, text=label).pack(anchor="w", pady=(6, 2))
            variable = tk.StringVar(value=values[self.config[key]])
            self.settings_vars[key] = variable
            ttk.Combobox(frame, textvariable=variable, state="readonly", values=list(values.values()), width=15).pack(anchor="w")
        ttk.Button(frame, text="Salvar configurações", style="Primary.TButton", command=self.save_settings).pack(anchor="w", pady=12)
        ttk.Label(frame, textvariable=self.connection, wraplength=780, style="Muted.TLabel").pack(anchor="w")
        self.account = ttk.Label(frame, style="Muted.TLabel")
        self.account.pack(anchor="w")
        row = ttk.Frame(frame)
        row.pack(fill="x", pady=(7, 0))
        ttk.Button(row, text="Entrar / trocar conta Firebase", command=self.login_window).pack(side="left")
        ttk.Button(row, text="Desconectar conta", command=self.disconnect).pack(side="left", padx=8)

    def build_tools(self, frame):
        sections = [
            ("Relatórios", "Exporte os registros do grupo selecionado.",
             [("Excel semanal", lambda: self.export("week")), ("Excel mensal", lambda: self.export("month")),
              ("Gráficos em PNG", lambda: self.export("png"))]),
            ("Sincronização", "Consulte a fila de leituras e reenvie os registros que precisam de revisão.",
             [("Sincronizar agora", lambda: self.run(lambda: self.cloud.sync(full=True), sync=True)),
              ("Ver fila", self.queue_window), ("Reenviar em revisão", self.retry_scans)]),
            ("Backup", "Uma cópia do SQLite é feita por dia de uso, com retenção de 30 arquivos.",
             [("Fazer backup agora", self.backup), ("Abrir pasta de dados", self.open_data)]),
            ("Integrantes", "Arquive os integrantes do grupo e mantenha seus registros e horas.",
             [("Arquivar integrantes do grupo", self.archive_all)]),
            ("Segurança", "Altere a senha que abre o painel nesta estação.",
             [("Alterar senha local", self.change_pin)]),
        ]
        for title, explanation, buttons in sections:
            ttk.Label(frame, text=title, style="Section.TLabel").pack(anchor="w", pady=(7, 0))
            ttk.Label(frame, text=explanation, style="Muted.TLabel").pack(anchor="w")
            row = ttk.Frame(frame)
            row.pack(fill="x", pady=(5, 3))
            for label, command in buttons:
                ttk.Button(row, text=label, command=command).pack(side="left", padx=(0, 7))

    def render_admin(self):
        if not self.panel or not self.panel.winfo_exists():
            return
        self.data = self.store.data(self.group)
        today = lab_now().date()
        _, by_day, self.chart_people = report(self.data, *period(today, "month"))
        _, days, _ = report(self.data, today - timedelta(days=13), today)
        self.chart_days = [(day, len(days.get(day, ()))) for day in days_between(today - timedelta(days=13), today)]
        total = sum(map(len, by_day.values()))
        active = sum(person["active"] for person in self.data[0].values())
        for label, value in zip(self.metrics, (self.chart_days[-1][1], total, f"{total / max(1, len(by_day)):.1f}".replace(".", ","), active)):
            label.configure(text=value)
        self.draw_charts()
        self.render_people()
        self.render_history(quiet=True)
        self.account.configure(text=("Conta: " + self.cloud.email + " · " + ({"admin": "Administrador", "kiosk": "Estação"}.get(self.cloud.role, "verificando"))) if self.cloud.email else "Nenhuma conta Firebase conectada.")

    def draw_charts(self):
        if not hasattr(self, "chart_days") or len(self.charts) < 2:
            return
        canvas, people = self.charts
        if not canvas.winfo_exists():
            return
        canvas.delete("all")
        people.delete("all")
        fg, bar = self.colors["muted"], self.colors["accent"]
        width, height = canvas.winfo_width(), canvas.winfo_height()
        interval, baseline = (width - 14) / 14, height - 34
        biggest = max(1, max(count for _, count in self.chart_days))
        for index, (day, count) in enumerate(self.chart_days):
            x = 7 + interval * (index + .5)
            bar_height = max(1, count / biggest * (height - 74))
            canvas.create_rectangle(x - interval * .28, baseline - bar_height, x + interval * .28, baseline, fill=bar, width=0)
            canvas.create_text(x, baseline - bar_height - 9, text=count, fill=fg, font=("Segoe UI", 9, "bold"))
            if index % 2 or index == 0 and width >= 550:
                canvas.create_text(x, baseline + 15, text=day.strftime("%d/%m"), fill=fg, font=("Segoe UI", 8))
        if not self.chart_people:
            people.create_text(12, 24, text="Sem presenças no mês.", fill=fg, anchor="w")
        biggest = max((len(person["days"]) for person in self.chart_people), default=1)
        width = people.winfo_width()
        name_width = int(width * .44)
        for index, person in enumerate(self.chart_people):
            y = 20 + index * 38
            count = len(person["days"])
            bar_width = max(2, (width - name_width - 38) * count / biggest)
            people.create_text(10, y, text=person["name"], width=max(20, name_width - 18),
                               fill=fg, anchor="w", font=("Segoe UI", 9))
            people.create_rectangle(name_width, y - 10, name_width + bar_width, y + 10, fill=bar, width=0)
            people.create_text(name_width + bar_width + 6, y, text=count, fill=fg, anchor="w")
        people.configure(scrollregion=(0, 0, width, max(people.winfo_height(), 38 * len(self.chart_people))))

    def render_people(self):
        members, _, hours = self.store.data(self.group)
        search = self.member_filter.get().strip().casefold()
        selection = self.people_table.selection()
        self.people_table.delete(*self.people_table.get_children())
        for key, person in sorted(members.items(), key=lambda row: row[1]["name"].casefold()):
            if not person["active"] and not self.show_archived.get():
                continue
            if search not in person["name"].casefold() and search not in person["tag"]:
                continue
            self.people_table.insert("", "end", iid=key, values=(person["name"], person["tag"], hours.get(key, 0),
                                                               "Ativo" if person["active"] else "Arquivado"))
        if selection and self.people_table.exists(selection[0]):
            self.people_table.selection_set(selection[0])

    def selected_member(self):
        selection = self.people_table.selection()
        if not selection:
            messagebox.showinfo("Integrantes", "Selecione um integrante na tabela.", parent=self.panel)
            return ""
        return selection[0]

    def require_admin(self):
        if self.cloud.role == "admin":
            return True
        messagebox.showinfo("Painel ADM", "Entre com uma conta administradora em Configurações.", parent=self.panel)
        return False

    def member_window(self, member_id=None):
        if member_id == "" or not self.require_admin():
            return
        group = self.group
        person = self.store.data(group)[0].get(member_id, {})
        window = tk.Toplevel(self.panel)
        window.title("Editar integrante" if member_id else "Cadastrar integrante")
        window.transient(self.panel)
        window.grab_set()
        fields = ttk.Frame(window, padding=20)
        fields.pack(fill="both")
        name = tk.StringVar(value=person.get("name", ""))
        tag = tk.StringVar(value=person.get("tag", ""))
        ttk.Label(fields, text=f"{GROUPS[group]} · Nome completo").pack(anchor="w")
        name_input = ttk.Entry(fields, textvariable=name, width=42)
        name_input.pack(fill="x", pady=(3, 8))
        ttk.Label(fields, text="TAG (opcional). Clique no campo e aproxime a TAG.").pack(anchor="w")
        tag_input = ttk.Entry(fields, textvariable=tag, width=42)
        tag_input.pack(fill="x", pady=(3, 10))
        tag_input.bind("<Return>", lambda event: "break")

        def save():
            member_key, full_name, tag_number = member_id or "m_" + str(uuid4()), name.get(), tag.get().strip()
            if self.run(lambda: self.save_member(group, member_key, full_name, tag_number),
                        lambda error: self.member_saved(error, window, button)):
                button.configure(state="disabled")

        button = ttk.Button(fields, text="Salvar integrante", style="Primary.TButton", command=save)
        button.pack(anchor="e")
        name_input.focus_set()

    def save_member(self, group, *args, **kwargs):
        self.cloud.save_member(group, *args, **kwargs)
        self.cloud.download(group)

    def member_saved(self, error, window=None, button=None):
        if error:
            messagebox.showerror("Integrantes", self.error_text(error), parent=window if window and window.winfo_exists() else self.panel or self.root)
            if button and button.winfo_exists():
                button.configure(state="normal")
        elif window and window.winfo_exists():
            window.destroy()

    def toggle_member(self):
        member_id = self.selected_member()
        if not member_id or not self.require_admin():
            return
        group = self.group
        person = self.store.data(group)[0][member_id]
        self.run(lambda: self.save_member(group, member_id, person["name"], person["tag"], toggle=True), self.member_saved)

    def archive_all(self):
        if not self.require_admin():
            return
        group = self.group
        if messagebox.askyesno("Arquivar integrantes", f"Arquivar todos os integrantes ativos do {GROUPS[group]}? O histórico será mantido.", parent=self.panel):
            self.run(lambda: self.save_member(group, "", "", "", archive_all=True), self.member_saved)

    def date_range(self, quiet=False):
        try:
            start, end = date.fromisoformat(self.from_date.get()), date.fromisoformat(self.to_date.get())
            if not 0 <= (end - start).days <= 3660:
                raise ValueError
            return start, end
        except ValueError:
            if not quiet:
                messagebox.showerror("Frequência", "Informe datas no formato aaaa-mm-dd em ordem. Use um intervalo de até 10 anos.", parent=self.panel)
            return None

    def render_history(self, quiet=False):
        dates = self.date_range(quiet=True)
        if dates is None:
            self.history.delete(*self.history.get_children())
            self.history_msg.configure(text="Informe datas válidas de início e fim no formato aaaa-mm-dd.")
            return
        rows, _, _ = report(self.store.data(self.group), *dates)
        query = self.report_name.get().strip().casefold()
        rows = [row for row in rows if query in row["name"].casefold()]
        origin = {"legacy": "Histórico", "rfid": "TAG", "manual": "Manual"}
        self.history.delete(*self.history.get_children())
        for row in reversed(rows):
            self.history.insert("", "end", values=(date.fromisoformat(row["date"]).strftime("%d/%m/%Y"),
                                                   SHIFTS[row["shift"]], row["name"], origin[row["source"]], 4))
        self.history_msg.configure(text=f"{len(rows)} turno(s) com presença")

    def save_settings(self):
        settings = {key: value.get().strip() for key, value in self.settings_vars.items()}
        for key, options in (("group", GROUPS), ("shift", SHIFTS)):
            settings[key] = next(code for code, label in options.items() if label == settings[key])
        for key in ("title", "lab"):
            settings[key] = settings[key][:70] or DEFAULTS[key]
        settings["campus"] = settings["campus"][:90]
        settings["teacher"] = settings["teacher"][:90]
        self.store.set_settings(settings)
        self.config.update(settings)
        self.notice = ("Aguardando leitura", "muted")
        self.render_kiosk()
        self.panel.lift()
        messagebox.showinfo("Configurações", "Estação atualizada.", parent=self.panel)

    def login_window(self):
        window = tk.Toplevel(self.panel)
        window.title("Conectar ao Firebase")
        window.transient(self.panel)
        window.grab_set()
        form = ttk.Frame(window, padding=20)
        form.pack()
        email, password = tk.StringVar(value=self.cloud.email), tk.StringVar()
        ttk.Label(form, text="E-mail Firebase").pack(anchor="w")
        ttk.Entry(form, textvariable=email, width=40).pack(pady=(0, 8))
        ttk.Label(form, text="Senha Firebase").pack(anchor="w")
        ttk.Entry(form, textvariable=password, show="•", width=40).pack(pady=(0, 8))

        def done(error):
            self.sync_status(error)
            if not window.winfo_exists():
                return
            if error:
                messagebox.showerror("Conectar ao Firebase", self.error_text(error), parent=window)
                button.configure(state="normal")
            else:
                window.destroy()

        def submit():
            mail, secret = email.get().strip(), password.get()
            if not mail or not secret:
                return
            def connect():
                self.cloud.login(mail, secret)
                self.cloud.sync(pull=True)
            if self.run(connect, done):
                button.configure(state="disabled")
                password.set("")

        button = ttk.Button(form, text="Conectar", style="Primary.TButton", command=submit)
        button.pack(anchor="e")

    def disconnect(self):
        if self.job:
            messagebox.showinfo("Configurações", "Aguarde a sincronização atual.", parent=self.panel)
            return
        self.cloud.logout()
        self.connection.set("Conta desconectada. As leituras continuam sendo salvas neste computador.")
        self.render_admin()

    def retry_scans(self):
        self.store.retry_blocked()
        self.sync_requested = True
        self.render_recent()

    def queue_window(self):
        window = tk.Toplevel(self.panel)
        window.title("Fila de sincronização")
        window.geometry("950x460")
        frame = ttk.Frame(window, padding=15)
        frame.pack(fill="both", expand=True)
        table = self.table(frame, ["Grupo", "Data", "Turno", "Integrante", "Situação", "Detalhe"], [80, 100, 80, 165, 95, 315])
        people = {group: self.store.data(group)[0] for group in GROUPS}
        for group, _, row, status, error in self.store.scans():
            name = people[group].get(row["memberId"], {}).get("name", row["memberId"])
            table.insert("", "end", values=(GROUPS[group], row["date"], SHIFTS[row["shift"]], name, STATUS[status], error))

    def export(self, kind):
        from relatorios import export_excel, export_png
        group, today = self.group, lab_now().date()
        data = self.store.data(group)
        ext = ".png" if kind == "png" else ".xlsx"
        dates = self.date_range() if kind == "custom" else period(today, kind)
        if dates is None:
            return
        if kind == "custom" and self.report_name.get().strip():
            members, records, hours = data
            query = self.report_name.get().strip().casefold()
            matching = {key for key, person in members.items() if query in person["name"].casefold()}
            data = members, {key: row for key, row in records.items() if row["memberId"] in matching}, hours
        target = filedialog.asksaveasfilename(parent=self.panel, defaultextension=ext,
                                             initialfile=f"frequencia-{group}-{kind}-{today}{ext}",
                                             filetypes=[("Imagem PNG" if kind == "png" else "Planilha Excel", "*" + ext)])
        if target:
            try:
                if kind == "png":
                    export_png(target, group, data, today)
                else:
                    export_excel(target, group, data, *dates)
                messagebox.showinfo("Exportação", "Arquivo salvo.", parent=self.panel)
            except (OSError, ValueError) as error:
                messagebox.showerror("Exportação", str(error), parent=self.panel)

    def backup(self):
        path = filedialog.asksaveasfilename(parent=self.panel, defaultextension=".sqlite3",
                                            initialfile=f"frequencia-backup-{lab_now():%Y-%m-%d-%H%M%S}.sqlite3",
                                            filetypes=[("Backup SQLite", "*.sqlite3")])
        if not path:
            return
        if Path(path).resolve() == self.store.path.resolve():
            messagebox.showerror("Backup", "Escolha um arquivo diferente do banco em uso.", parent=self.panel)
            return
        try:
            self.store.backup(path)
            messagebox.showinfo("Backup", "Backup concluído.", parent=self.panel)
        except (OSError, ValueError, sqlite3.Error) as error:
            messagebox.showerror("Backup", str(error), parent=self.panel)

    def open_data(self):
        if sys.platform == "win32":
            os.startfile(self.store.directory)
        else:
            subprocess.Popen(["xdg-open", str(self.store.directory)])

    def change_pin(self):
        old = simpledialog.askstring("Senha local", "Senha atual", show="•", parent=self.panel)
        if old is None:
            return
        if not self.store.pin_matches(old):
            messagebox.showerror("Senha local", "Senha incorreta.", parent=self.panel)
            return
        new = simpledialog.askstring("Senha local", "Nova senha (8 ou mais caracteres)", show="•", parent=self.panel)
        if new is None:
            return
        confirm = simpledialog.askstring("Senha local", "Confirme a nova senha", show="•", parent=self.panel)
        if len(new) < 8 or new != confirm:
            messagebox.showerror("Senha local", "As senhas devem coincidir e ter pelo menos 8 caracteres.", parent=self.panel)
            return
        self.store.set_pin(new)
        messagebox.showinfo("Senha local", "Senha atualizada.", parent=self.panel)


def main():
    root = tk.Tk()
    config = json.loads((BASE / "firebase-public.json").read_text(encoding="utf-8"))
    store = LocalStore()
    FrequencyApp(root, store, Firebase(config, store))
    root.mainloop()


if __name__ == "__main__":
    main()
