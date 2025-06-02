@echo off
setlocal

:: إعداد المتغيرات
set REPO_URL=https://github.com/youven/chatApp.git
set REPO_NAME=chatApp-mirror
set SECRET_FILE=serviceAccountKey.json
set BFG_PATH=C:\bfg\bfg.jar

echo 🔄 حذف المجلد القديم إن وُجد...
rd /s /q %REPO_NAME%

echo 🔁 استنساخ الريبو كاملًا بصيغة --mirror...
git clone --mirror %REPO_URL% %REPO_NAME%
cd %REPO_NAME%

echo 🧹 تنظيف الريبو باستخدام BFG...
java -jar %BFG_PATH% --delete-files %SECRET_FILE%

echo ♻️ تنظيف الريبو نهائيًا...
git reflog expire --expire=now --all
git gc --prune=now --aggressive

echo 🚀 دفع التغييرات بالقوة...
git push --force

echo ✅ تمت العملية بنجاح (إذا لم يظهر خطأ من GitHub).
pause
