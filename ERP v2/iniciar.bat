@echo off
chcp 65001 >nul
title ERP Server - Puerto 80
cd /d "%~dp0"

:: Activar entorno virtual
call venv\Scripts\activate.bat

echo ==========================================
echo   LEVANTANDO ERP + FRONTEND
echo   Puerto: 80 (acceso sin :puerto)
echo   Admin:  http://localhost/admin/
echo   API:   http://localhost/api/v1/
echo   POS:   http://localhost/
echo ==========================================
echo.

:: Puerto 80 requiere admin en Windows
uvicorn config.asgi:application --host 0.0.0.0 --port 80 --reload

pause