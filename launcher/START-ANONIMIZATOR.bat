@echo off
rem Anonimizator - start lokalnej aplikacji z AI (bez instalacji).
rem Uruchamia mini-serwer na 127.0.0.1 i otwiera przegladarke.
cd /d "%~dp0"
title Anonimizator
powershell -NoProfile -File "%~dp0serve.ps1"
pause
