@echo off
REM Cambia a la carpeta donde está tu app
cd /d "D:\nuevo\erp-backend"

REM (Opcional) Activar entorno virtual si lo usas
python -m venv venv
call venv\Scripts\activate

REM Ejecutar Streamlit
python manage.py runserver 0.0.0.0:8000

REM Mantener la ventana abierta al terminar
pause
