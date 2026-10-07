' ============================================================
'  AI Herb Lab - 키오스크 부팅 자동실행 런처 (창 숨김)
'  - 프리뷰 서버(port 4173)를 cmd 창 없이 백그라운드로 띄우고
'  - 서버가 응답하면 Chrome 키오스크(전체화면)를 포그라운드로 실행
'  사용: 이 파일의 "바로 가기"를 shell:startup 폴더에 넣으면 부팅 시 자동 실행됨
' ============================================================
Option Explicit

Dim sh, fso, appDir
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 이 스크립트가 있는 폴더 = 앱 폴더 (경로 고정 불필요, 폴더째 옮겨도 동작)
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = appDir

' --- 1) 최초 1회 보호: node_modules / dist 없으면 빌드부터 (이때만 창 보임) ---
If (Not fso.FolderExists(appDir & "\node_modules")) Or (Not fso.FolderExists(appDir & "\dist")) Then
    ' install + build 는 진행상황을 봐야 하므로 일반 창으로 실행하고 끝날 때까지 대기
    If Not fso.FolderExists(appDir & "\node_modules") Then sh.Run "cmd /c npm install", 1, True
    If Not fso.FolderExists(appDir & "\dist") Then sh.Run "cmd /c npm run build", 1, True
End If

' --- 2) 프리뷰 서버를 창 없이(0=Hidden) 백그라운드로 기동 ---
sh.Run "cmd /c npm run preview -- --port 4173 --strictPort --host", 0, False

' --- 3) 서버가 실제로 응답할 때까지 대기 (최대 ~30초 폴링) ---
Dim i, ready
ready = False
For i = 1 To 60
    WScript.Sleep 500
    If ServerReady("http://localhost:4173/index.html") Then
        ready = True
        Exit For
    End If
Next

' --- 4) Chrome 경로 탐색 ---
Dim chrome
chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If Not fso.FileExists(chrome) Then chrome = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"

' --- 5) Chrome 키오스크 전체화면 실행 (1=일반창 → 포그라운드 점유) ---
Dim cmdLine
cmdLine = """" & chrome & """" _
    & " --kiosk ""http://localhost:4173/index.html""" _
    & " --user-data-dir=""" & appDir & "\.chrome-kiosk""" _
    & " --autoplay-policy=no-user-gesture-required" _
    & " --use-fake-ui-for-media-stream" _
    & " --start-fullscreen --noerrdialogs" _
    & " --disable-session-crashed-bubble --disable-infobars" _
    & " --no-first-run --no-default-browser-check"
sh.Run cmdLine, 1, False

' ------------------------------------------------------------
' 서버 응답 확인용 (Windows 내장 MSXML 사용, 추가 설치 불필요)
Function ServerReady(url)
    On Error Resume Next
    Dim http
    Set http = CreateObject("MSXML2.XMLHTTP")
    http.Open "GET", url, False
    http.Send
    ServerReady = (Err.Number = 0) And (http.Status = 200)
    On Error GoTo 0
End Function
