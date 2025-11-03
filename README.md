# Face Recognition Web (Python + Flask)

A simple web app that shows your camera in the browser and recognizes registered faces using a Python backend.

## Features

- Live camera preview in browser
- Register a face with a name
- Recognize known faces in real time
- Stores face encodings in `data/users.json`

## Prerequisites (Windows)

Face recognition uses the `face_recognition` library which depends on `dlib`. On Windows, ensure you have:

- Python 3.10+ (64-bit recommended)
- Microsoft C++ Build Tools (via Visual Studio Build Tools) or prebuilt wheels available for your Python version

If `pip install face-recognition` fails on dlib, install Build Tools then try again, or consider using a virtual environment matching common wheel availability.

## Setup and Run (PowerShell)

```powershell
# 1) Create and activate virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# 2) Upgrade pip
python -m pip install --upgrade pip

# 3) Install dependencies
pip install -r requirements.txt

# 4) Run the server
$env:FLASK_DEBUG="1"; python app.py
# App runs at http://localhost:5000
```

Open http://localhost:5000 to see the camera view. Use the "Daftarkan Wajah" link to enroll your face (enter a name, ensure only one face is visible, then click "Ambil & Daftar").

## API

- POST `/api/register` JSON `{ name: string, image: base64jpeg }`
- POST `/api/recognize` JSON `{ image: base64jpeg }` -> `{ ok, faces: [{ box, name, distance }] }`
- GET `/api/users` -> list of registered names and counts

## Notes

- Threshold for a match is 0.6 (stricter is lower). Adjust in `app.py` if needed.
- All processing happens on the server with Python; frames are sent from the browser as JPEG base64.
- You can back up `data/users.json` to preserve enrollments.
