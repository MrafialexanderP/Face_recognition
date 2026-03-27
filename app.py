import os
import sys
import json
import base64
import hashlib
import contextlib
from difflib import SequenceMatcher
from io import BytesIO, StringIO
from datetime import datetime

from flask import Flask, request, jsonify, send_from_directory

face_recognition = None
try:
    import numpy as np
except Exception as e:
    np = None

try:
    from PIL import Image
except Exception as e:
    Image = None

try:
    with contextlib.redirect_stdout(StringIO()), contextlib.redirect_stderr(StringIO()):
        import face_recognition
except BaseException:
    face_recognition = None

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(APP_ROOT, "public")
DATA_DIR = os.path.join(APP_ROOT, "data")
USERS_DB = os.path.join(DATA_DIR, "users.json")

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")

# Recognition threshold (lower = more strict)
RECOGNITION_TOLERANCE = 0.6


def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(USERS_DB):
        with open(USERS_DB, "w", encoding="utf-8") as f:
            json.dump({"users": []}, f, ensure_ascii=False, indent=2)


def load_users():
    ensure_data_files()
    with open(USERS_DB, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def save_users(data):
    with open(USERS_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def decode_image_to_rgb(image_b64: str):
    """Decode a base64 string to RGB numpy array."""
    if np is None or Image is None:
        raise RuntimeError("Dependencies not installed.")
    try:
        img_bytes = base64.b64decode(image_b64)
        pil_img = Image.open(BytesIO(img_bytes)).convert("RGB")
        return np.array(pil_img)
    except Exception as e:
        raise ValueError(f"Failed to decode image: {e}")


def build_fallback_fingerprint(image_b64: str):
    """Build a lightweight fingerprint from base64 bytes (dependency-free fallback)."""
    try:
        raw = base64.b64decode(image_b64)
    except Exception as e:
        raise ValueError(f"Failed to decode image: {e}")

    digest = hashlib.sha256(raw).hexdigest()
    sampled = image_b64[::24][:1200]
    return {
        "sha256": digest,
        "sample": sampled
    }


def fallback_similarity(sample_a: str, sample_b: str):
    if not sample_a or not sample_b:
        return 0.0
    return SequenceMatcher(None, sample_a, sample_b).ratio()


@app.route("/")
def root():
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/register")
def register_page():
    return send_from_directory(PUBLIC_DIR, "register.html")


@app.route("/result")
def result_page():
    return send_from_directory(PUBLIC_DIR, "result.html")


@app.route("/users")
def users_page():
    return send_from_directory(PUBLIC_DIR, "users.html")


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/api/users", methods=["GET"])
def list_users():
    """Get all registered users with their info (without encodings)"""
    data = load_users()
    users_list = []
    for u in data.get("users", []):
        users_list.append({
            "id": u.get("id"),
            "name": u.get("name"),
            "nim": u.get("nim"),
            "gender": u.get("gender"),
            "age": u.get("age"),
            "photo": u.get("photo"),
            "registered_at": u.get("registered_at")
        })
    return jsonify({"ok": True, "users": users_list})


@app.route("/api/users/<user_id>", methods=["DELETE"])
def delete_user(user_id):
    """Delete a user by ID"""
    data = load_users()
    users = data.get("users", [])
    initial_count = len(users)
    users = [u for u in users if u.get("id") != user_id]
    
    if len(users) == initial_count:
        return jsonify({"ok": False, "error": "User not found"}), 404
    
    data["users"] = users
    save_users(data)
    return jsonify({"ok": True, "message": "User deleted successfully"})


@app.route("/api/register", methods=["POST"])
def api_register():
    """Register a new face with biodata"""
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    nim = (payload.get("nim") or "").strip()
    gender = (payload.get("gender") or "").strip()
    age = payload.get("age")
    image_b64 = payload.get("image")
    
    # Validation
    if not name:
        return jsonify({"ok": False, "error": "Nama wajib diisi."}), 400
    if not nim:
        return jsonify({"ok": False, "error": "NIM wajib diisi."}), 400
    if not gender or gender not in ["Laki-laki", "Perempuan"]:
        return jsonify({"ok": False, "error": "Jenis kelamin tidak valid."}), 400
    if not age or not isinstance(age, int) or age < 1 or age > 150:
        return jsonify({"ok": False, "error": "Usia tidak valid."}), 400
    if not image_b64:
        return jsonify({"ok": False, "error": "Foto tidak ditemukan."}), 400

    rgb = None
    if face_recognition is not None:
        try:
            rgb = decode_image_to_rgb(image_b64)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    fp = None
    if face_recognition is None:
        try:
            fp = build_fallback_fingerprint(image_b64)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    try:
        model = (payload.get("model") or "auto").lower()
        
        encoding = []
        if face_recognition is not None:
            # Detect face
            if model == "cnn":
                boxes = face_recognition.face_locations(rgb, model="cnn", number_of_times_to_upsample=1)
            elif model == "hog":
                boxes = face_recognition.face_locations(rgb, model="hog")
            else:  # auto
                boxes = face_recognition.face_locations(rgb, model="hog")
                if not boxes:
                    boxes = face_recognition.face_locations(rgb, model="cnn", number_of_times_to_upsample=1)

            if len(boxes) == 0:
                return jsonify({"ok": False, "error": "Tidak ada wajah terdeteksi. Pastikan wajah Anda terlihat jelas."}), 400
            if len(boxes) > 1:
                return jsonify({"ok": False, "error": f"Ditemukan {len(boxes)} wajah. Pastikan hanya ada satu wajah."}), 400

            # Extract encoding
            enc = face_recognition.face_encodings(rgb, boxes, num_jitters=2)
            if not enc:
                return jsonify({"ok": False, "error": "Gagal mengekstrak fitur wajah."}), 400

            encoding = enc[0].tolist()
        
        # Generate unique ID
        user_id = f"user_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
        
        # Save user data
        data = load_users()
        user_data = {
            "id": user_id,
            "name": name,
            "nim": nim,
            "gender": gender,
            "age": age,
            "photo": image_b64,
            "encoding": encoding,
            "fallback_fp": fp,
            "registered_at": datetime.now().isoformat()
        }
        data.setdefault("users", []).append(user_data)
        save_users(data)
        
        return jsonify({
            "ok": True,
            "message": f"Berhasil mendaftarkan {name}",
            "mode": "face_recognition" if face_recognition is not None else "fallback",
            "user_id": user_id
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal mendaftar: {e}"}), 500


@app.route("/api/recognize", methods=["POST"])
def api_recognize():
    """Recognize face and return matched user data"""
    payload = request.get_json(silent=True) or {}
    image_b64 = payload.get("image")
    model_pref = (payload.get("model") or "auto").lower()
    
    if not image_b64:
        return jsonify({"ok": False, "error": "Gambar tidak ditemukan."}), 400

    rgb = None
    fp = None
    if face_recognition is not None:
        try:
            rgb = decode_image_to_rgb(image_b64)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400
    else:
        try:
            fp = build_fallback_fingerprint(image_b64)
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 400

    try:
        unknown_encoding = None
        if face_recognition is not None:
            # Detect faces
            if model_pref == "cnn":
                boxes = face_recognition.face_locations(rgb, model="cnn", number_of_times_to_upsample=1)
            elif model_pref == "hog":
                boxes = face_recognition.face_locations(rgb, model="hog")
            else:  # auto
                boxes = face_recognition.face_locations(rgb, model="hog")
                if not boxes:
                    boxes = face_recognition.face_locations(rgb, model="cnn", number_of_times_to_upsample=1)

            if len(boxes) == 0:
                return jsonify({"ok": False, "error": "Tidak ada wajah terdeteksi."}), 400

            if len(boxes) > 1:
                return jsonify({"ok": False, "error": f"Ditemukan {len(boxes)} wajah. Pastikan hanya ada satu wajah."}), 400

            # Extract encoding from detected face
            face_encodings = face_recognition.face_encodings(rgb, boxes, num_jitters=1)
            if not face_encodings:
                return jsonify({"ok": False, "error": "Gagal mengekstrak fitur wajah."}), 400

            unknown_encoding = face_encodings[0]
        
        # Load registered users
        data = load_users()
        users = data.get("users", [])
        
        if not users:
            return jsonify({"ok": False, "error": "Belum ada wajah terdaftar. Silakan registrasi terlebih dahulu."}), 404
        
        # Compare with all registered faces
        best_match = None
        best_distance = float('inf')
        
        for user in users:
            if face_recognition is not None:
                known_encoding = np.array(user.get("encoding", []))
                if known_encoding.size == 0:
                    continue

                # Calculate face distance
                distance = face_recognition.face_distance([known_encoding], unknown_encoding)[0]

                if distance < best_distance and distance < RECOGNITION_TOLERANCE:
                    best_distance = distance
                    best_match = user
            else:
                known_fp = user.get("fallback_fp") or {}
                if not known_fp.get("sample") and user.get("photo"):
                    try:
                        known_fp = build_fallback_fingerprint(user.get("photo"))
                    except Exception:
                        known_fp = {}
                similarity = fallback_similarity(fp.get("sample", ""), known_fp.get("sample", ""))
                # Convert similarity to pseudo-distance
                distance = 1 - similarity
                if distance < best_distance and similarity >= 0.68:
                    best_distance = distance
                    best_match = user
        
        if best_match:
            confidence = round((1 - best_distance) * 100, 2)
            return jsonify({
                "ok": True,
                "matched": True,
                "mode": "face_recognition" if face_recognition is not None else "fallback",
                "user": {
                    "id": best_match.get("id"),
                    "name": best_match.get("name"),
                    "nim": best_match.get("nim"),
                    "gender": best_match.get("gender"),
                    "age": best_match.get("age"),
                    "photo": best_match.get("photo"),
                    "confidence": confidence
                }
            })
        else:
            return jsonify({
                "ok": True,
                "matched": False,
                "mode": "face_recognition" if face_recognition is not None else "fallback",
                "message": "Wajah tidak dikenali. Silakan registrasi terlebih dahulu."
            })
            
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal mengenali wajah: {e}"}), 500


@app.errorhandler(Exception)
def handle_unexpected_error(err):
    if request.path.startswith("/api/"):
        return jsonify({"ok": False, "error": f"Internal server error: {err}"}), 500
    raise err


if __name__ == "__main__":
    ensure_data_files()
    port = int(os.environ.get("PORT", 5000))

    # Werkzeug reloader can crash in some terminals where stdin is closed.
    debug_mode = os.environ.get("FLASK_DEBUG", "1") == "1"
    try:
        stdin_is_tty = sys.stdin is not None and sys.stdin.isatty()
    except Exception:
        stdin_is_tty = False

    app.run(
        host="0.0.0.0",
        port=port,
        debug=debug_mode,
        use_reloader=debug_mode and stdin_is_tty,
    )