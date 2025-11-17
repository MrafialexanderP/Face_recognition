# Face Attendance System 🎯

Sistem absensi berbasis pengenalan wajah dengan anti-spoofing dan deteksi real-time menggunakan YOLO + face_recognition.

## Fitur Utama

✅ **Deteksi Wajah Real-time** - YOLO untuk deteksi multi-wajah cepat dan akurat  
✅ **Pengenalan Wajah** - Face recognition untuk identifikasi nama yang terdaftar  
✅ **Anti-Spoofing** - Liveness detection untuk mencegah foto palsu  
✅ **Absensi Otomatis** - Pencatatan kehadiran otomatis saat wajah dikenali  
✅ **Log Attendance** - Riwayat kehadiran dengan timestamp  
✅ **Multi-Angle Detection** - Deteksi wajah dari berbagai sudut  

## Status Deteksi

| Warna Box | Status | Keterangan |
|-----------|--------|------------|
| 🟢 Hijau + Nama | LIVE + Dikenali | Wajah asli & terdaftar (absensi otomatis tercatat) |
| 🟢 Hijau + Unknown | LIVE + Tidak dikenali | Wajah asli tapi belum terdaftar |
| 🔴 Merah + SPOOF | SPOOF | Foto/video palsu terdeteksi |

## Prerequisites (Windows)

- Python 3.10+ (64-bit)
- Microsoft C++ Build Tools (untuk dlib)
- Koneksi internet (download YOLO model pertama kali)

## Setup and Run

```powershell
# 1) Install dependencies
pip install -r requirements.txt

# 2) Run server
py app.py

# 3) Open browser
# http://localhost:5000
```

## Cara Menggunakan

### 1. Daftar Wajah Baru

1. Buka `http://localhost:5000/register`
2. Masukkan nama lengkap
3. Klik **START CAMERA**
4. Posisikan wajah (pastikan hanya 1 wajah terlihat)
5. Klik **CAPTURE & REGISTER**

### 2. Mulai Deteksi & Absensi

1. Buka `http://localhost:5000`
2. Klik **START**
3. Sistem akan mendeteksi, mengenali, dan mencatat absensi otomatis
4. Log kehadiran muncul di panel bawah

## API Endpoints

### Registrasi
```
POST /api/register
Body: { "name": "John Doe", "image": "base64_string" }
```

### Deteksi & Pengenalan
```
POST /api/detect
Body: { "image": "base64_string", "confidence": 0.3, "sessionId": 123 }
Response: { "ok": true, "faces": [{ "box": {...}, "name": "...", "liveness": {...} }] }
```

### Absensi
```
POST /api/attendance - Catat manual
GET /api/attendance?date=YYYY-MM-DD - Lihat riwayat
```

## Troubleshooting

**Wajah tidak terdeteksi**: Turunkan confidence slider ke 20-30%  
**Selalu SPOOF**: Gerakkan kepala sedikit untuk liveness motion  
**Tidak dikenali**: Daftar ulang dengan foto lebih jelas  
**Install gagal**: Install Visual Studio Build Tools dulu

## Technologies

- Flask + Python
- YOLOv8 (face detection)
- face_recognition/dlib (encoding)
- Liveness: Laplacian variance + motion analysis
- Frontend: Vanilla JS + Canvas
- You can back up `data/users.json` to preserve enrollments.
