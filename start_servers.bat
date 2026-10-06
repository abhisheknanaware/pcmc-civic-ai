@echo off
echo Starting Complaint AI System Servers...

echo Starting Backend Server...
cd backend
start cmd /k "npm run dev"
cd ..

echo Starting Frontend Server...
cd frontend
start cmd /k "npm run dev"
cd ..

echo Starting NLP Server...
cd nlp
start cmd /k ".\venv\Scripts\python.exe pipeline.py"
cd ..

echo All servers are starting up in new windows!
pause
