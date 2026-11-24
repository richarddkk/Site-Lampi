@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
    py -3 -m venv .venv || goto erro
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto erro
)
start "" ".venv\Scripts\pythonw.exe" app.py
exit /b 0
:erro
echo Verifique o Python instalado com py --version e tente novamente.
pause
exit /b 1
