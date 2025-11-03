import os
import json
import base64
from io import BytesIO

from flask import Flask, request, jsonify, send_from_directory

try:
    import numpy as np
    from PIL import Image
    import face_recognition
except Exception as e:
    # Defer import errors to runtime response for clearer guidance
    np = None
    Image = None
    face_recognition = None

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(APP_ROOT, "public")
DATA_DIR = os.path.join(APP_ROOT, "data")
USERS_DB = os.path.join(DATA_DIR, "users.json")

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")


def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(USERS_DB):
        with open(USERS_DB, "w", encoding="utf-8") as f:
            json.dump({"users": []}, f, ensure_ascii=False, indent=2)


def load_users():
    ensure_data_files()
    with open(USERS_DB, "r", encoding="utf-8") as f:
        data = json.load(f)
    # Keep encodings as lists; convert to numpy when comparing
    return data


def save_users(data):
    with open(USERS_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def decode_image_to_rgb(image_b64: str):
    """Decode a base64 (no data URL prefix) string to a RGB numpy array."""
    if np is None or Image is None:
        raise RuntimeError("Python packages not fully installed. Please install dependencies from requirements.txt.")
    try:
        img_bytes = base64.b64decode(image_b64)
        pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
        return np.array(pil_img)
    except Exception as e:
        raise ValueError(f"Gagal decode gambar: {e}")


@app.route("/")
def root():
    # Serve index.html
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/register")
def register_page():
    return send_from_directory(PUBLIC_DIR, "register.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/users", methods=["GET"]) 
def list_users():
    data = load_users()
    # Return unique names and their sample counts
    counts = {}
    for u in data.get("users", []):
        counts[u.get("name", "Unknown")] = counts.get(u.get("name", "Unknown"), 0) + 1
    return jsonify({"users": counts})


@app.route("/api/register", methods=["POST"]) 
def api_register():
    if face_recognition is None:
        return jsonify({"ok": False, "error": "Dependencies not installed. Install from requirements.txt (note: dlib/face_recognition on Windows requires Build Tools)."}), 500
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    image_b64 = payload.get("image")
    if not name:
        return jsonify({"ok": False, "error": "Nama wajib diisi."}), 400
    if not image_b64:
        return jsonify({"ok": False, "error": "Gambar tidak ditemukan."}), 400

    try:
        rgb = decode_image_to_rgb(image_b64)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    try:
        # Coba deteksi cepat (HOG) terlebih dahulu; jika gagal, fallback ke CNN (lebih akurat untuk berbagai arah wajah)
        boxes = face_recognition.face_locations(rgb, model="hog")
        if not boxes:
            boxes = face_recognition.face_locations(rgb, model="cnn")
        if len(boxes) != 1:
            return jsonify({"ok": False, "error": f"Ditemukan {len(boxes)} wajah. Harap pastikan hanya satu wajah saat pendaftaran."}), 400
        enc = face_recognition.face_encodings(rgb, boxes)
        if not enc:
            return jsonify({"ok": False, "error": "Tidak dapat mengekstrak fitur wajah."}), 400
        encoding = enc[0].tolist()

        data = load_users()
        data.setdefault("users", []).append({"name": name, "encoding": encoding})
        save_users(data)
        return jsonify({"ok": True, "message": f"Berhasil mendaftarkan {name}", "count": len(data.get("users", []))})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal mendaftar: {e}"}), 500


@app.route("/api/recognize", methods=["POST"]) 
def api_recognize():
    if face_recognition is None:
        return jsonify({"ok": False, "error": "Dependencies not installed. Install from requirements.txt (note: dlib/face_recognition on Windows requires Build Tools)."}), 500
    payload = request.get_json(silent=True) or {}
    image_b64 = payload.get("image")
    if not image_b64:
        return jsonify({"ok": False, "error": "Gambar tidak ditemukan."}), 400

    try:
        rgb = decode_image_to_rgb(image_b64)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    try:
        # Coba HOG dahulu (lebih cepat), lalu fallback ke CNN agar lebih robust untuk pose/arah wajah.
        boxes = face_recognition.face_locations(rgb, model="hog")
        if not boxes:
            boxes = face_recognition.face_locations(rgb, model="cnn")
        encs = face_recognition.face_encodings(rgb, boxes)

        data = load_users()
        known = data.get("users", [])
        known_encs = [np.array(u["encoding"], dtype=np.float32) for u in known]
        known_names = [u["name"] for u in known]

        results = []
        for box, enc in zip(boxes, encs):
            name = "Unknown"
            distance = None
            if known_encs:
                dists = face_recognition.face_distance(known_encs, enc)
                best_idx = int(np.argmin(dists))
                best_dist = float(dists[best_idx])
                # Typical threshold ~0.6 (lower = stricter)
                if best_dist <= 0.6:
                    name = known_names[best_idx]
                    distance = best_dist
                else:
                    distance = best_dist
            top, right, bottom, left = box
            results.append({
                "box": {"top": int(top), "right": int(right), "bottom": int(bottom), "left": int(left)},
                "name": name,
                "distance": distance
            })
        return jsonify({"ok": True, "faces": results})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal mengenali: {e}"}), 500


if __name__ == "__main__":
    ensure_data_files()
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
