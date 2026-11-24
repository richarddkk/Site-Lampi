"""Monta App-Windows-x64 a partir dos arquivos oficiais do CPython (mesma versão),
dos wheels Win x64 das dependências e do launcher compilado para Windows.
O diretório --tcltk é o conteúdo extraído do MSI tcltk do CPython.
"""
import argparse
import shutil
from pathlib import Path
from zipfile import ZipFile

BASE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--python-zip", type=Path, required=True)
parser.add_argument("--tcltk", type=Path, required=True)
parser.add_argument("--wheels", type=Path, required=True)
parser.add_argument("--launcher", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
output = args.output
runtime, app = output / "runtime", output / "app"
runtime.mkdir(parents=True, exist_ok=True)
app.mkdir(exist_ok=True)
with ZipFile(args.python_zip) as archive:
    archive.extractall(runtime)
pth, = runtime.glob("python*._pth")
python_version = pth.stem
pth.write_text(f"{python_version}.zip\n.\nLib\nLib/site-packages\n../app\n", encoding="utf-8")
for file in (args.tcltk / "DLLs").iterdir():
    if file.suffix in {".dll", ".pyd"}:
        shutil.copy2(file, runtime)
shutil.copytree(args.tcltk / "Lib" / "tkinter", runtime / "Lib" / "tkinter", dirs_exist_ok=True)
for folder in ("tcl8", "tcl8.6", "tk8.6"):
    shutil.copytree(args.tcltk / "tcl" / folder, runtime / "tcl" / folder, dirs_exist_ok=True)
for package in ("openpyxl", "et_xmlfile", "pillow"):
    wheel, = args.wheels.glob(f"{package}-*.whl")
    with ZipFile(wheel) as archive:
        archive.extractall(runtime / "Lib" / "site-packages")
for filename in ("app.py", "firebase_client.py", "firebase-public.json", "local.py", "modelo.py", "relatorios.py"):
    shutil.copy2(BASE / filename, app)
shutil.copy2(args.launcher, output / "Frequencia-LAMPI.exe")
