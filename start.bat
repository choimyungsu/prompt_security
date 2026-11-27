@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ============================================================
REM  Security Word Analyzer - Windows 실행 스크립트
REM   1) Node.js 확인
REM   2) .env 없으면 .env.example 복사
REM   3) npm 패키지 자동 설치 (node_modules 없을 때)
REM   4) MySQL 초기화 (DB/테이블/기본 사전)
REM   5) 서버 실행
REM ============================================================

cd /d "%~dp0"

echo.
echo ==========================================
echo   Security Word Analyzer - 로컬 실행
echo ==========================================
echo.

REM ---- 1) Node.js 확인 -------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js 가 설치되어 있지 않습니다.
  echo.
  echo   https://nodejs.org  에서 LTS 버전을 설치한 뒤
  echo   이 파일을 다시 실행해 주세요.  ^(권장: v20 이상^)
  echo.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODEVER=%%v
echo [1/5] Node.js !NODEVER! 확인됨

REM ---- 2) .env 준비 ----------------------------------------
if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo [2/5] .env 파일을 생성했습니다.  필요하면 접속 정보를 수정하세요.
  ) else (
    echo [2/5] .env.example 이 없어 환경변수를 그대로 사용합니다.
  )
) else (
  echo [2/5] 기존 .env 파일을 사용합니다.
)

REM ---- 3) 패키지 설치 --------------------------------------
if not exist "node_modules" (
  echo [3/5] 패키지 설치 중...  ^(처음 한 번만, 1~3분 소요^)
  call npm install
  if errorlevel 1 (
    echo.
    echo [오류] npm install 이 실패했습니다.
    echo        네트워크 또는 npm 캐시를 확인한 뒤 다시 실행해 주세요.
    echo.
    pause
    exit /b 1
  )
) else (
  echo [3/5] 패키지가 이미 설치되어 있습니다.  ^(건너뜀^)
)

REM ---- 4) MySQL 초기화 -------------------------------------
echo [4/5] MySQL 초기화 확인 중...
call npm run db:setup
if errorlevel 1 (
  echo.
  echo [안내] DB 초기화에 실패했습니다.
  echo        - MySQL 서비스가 실행 중인지 확인하세요.
  echo        - .env 의 MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE 를 확인하세요.
  echo        - 위 안내에 따라 관리자 계정으로 DB/사용자를 만든 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

REM ---- 5) 서버 실행 ----------------------------------------
echo.
echo [5/5] 서버를 시작합니다.
echo        브라우저에서  http://localhost:3000  을 여세요.
echo        종료하려면 이 창에서 Ctrl + C 를 누르세요.
echo.
call npm run start:local

echo.
echo 서버가 종료되었습니다.
pause
