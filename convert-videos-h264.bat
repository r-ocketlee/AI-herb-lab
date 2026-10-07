@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ===== AI Herb Lab - 영상 일괄 H.264(8bit) 변환 =====
rem 모든 assets\videos\*.mp4 를 범용 H.264로 재인코딩합니다.
rem - HEVC 의존 제거(Windows+Chrome 디코딩 안정), 'ended' 이벤트 정상화
rem - 원본은 assets\videos\_hevc_backup\ 에 자동 백업(1회)
rem - 재실행 시 항상 '백업(원본)'에서 인코딩하므로 화질 손실 누적 없음

set "FFMPEG="
where ffmpeg >/dev/null 2>/dev/null && set "FFMPEG=ffmpeg"
if not defined FFMPEG if exist "ffmpeg.exe" set "FFMPEG=ffmpeg.exe"
if not defined FFMPEG (
  echo.
  echo [오류] ffmpeg 를 찾을 수 없습니다.
  echo   https://www.gyan.dev/ffmpeg/builds/  에서 "release essentials" zip 다운로드,
  echo   압축 해제 후 ffmpeg.exe 를 이 bat 파일 옆에 두거나 PATH 에 추가하세요.
  echo.
  pause
  exit /b 1
)
echo Using ffmpeg: %FFMPEG%

set "VID=assets\videos"
set "BK=%VID%\_hevc_backup"
if not exist "%VID%" ( echo [오류] %VID% 폴더가 없습니다. & pause & exit /b 1 )
if not exist "%BK%" mkdir "%BK%"

set /a OK=0, FAIL=0
for /r "%VID%" %%F in (*.mp4) do (
  echo %%F | find /i "_hevc_backup" >/dev/null
  if errorlevel 1 (
    set "SRC=%%F"
    set "NAME=%%~nxF"
    set "BAK=%BK%\!NAME!"
    if not exist "!BAK!" copy /y "!SRC!" "!BAK!" >/dev/null
    set "TMP=%BK%\!NAME!.tmp.mp4"
    echo.
    echo [encode] !NAME!
    "%FFMPEG%" -y -hide_banner -loglevel error -i "!BAK!" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 20 -preset slow -movflags +faststart -an "!TMP!"
    if exist "!TMP!" (
      move /y "!TMP!" "!SRC!" >/dev/null
      set /a OK+=1
      echo    OK
    ) else (
      set /a FAIL+=1
      echo    실패 - 원본 유지: !NAME!
    )
  )
)
echo.
echo ===== 변환 완료:  성공 !OK! / 실패 !FAIL! =====
echo 원본 백업 위치: %BK%
echo.
echo 다음 단계:  npm run build  후 키오스크 재시작
pause
