import os
import json
import base64
from io import BytesIO

from flask import Flask, request, jsonify, send_from_directory

try:
    import numpy as np
    from PIL import Image
    import cv2
    from ultralytics import YOLO
    import face_recognition
except Exception as e:
    # Defer import errors to runtime response for clearer guidance
    np = None
    Image = None
    cv2 = None
    YOLO = None
    face_recognition = None

APP_ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DIR = os.path.join(APP_ROOT, "public")
DATA_DIR = os.path.join(APP_ROOT, "data")
FACES_DIR = os.path.join(DATA_DIR, "faces")
USERS_DB = os.path.join(DATA_DIR, "users.json")
ATTENDANCE_DB = os.path.join(DATA_DIR, "attendance.json")

app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")

# Initialize YOLO model
yolo_model = None
liveness_sessions = {}
enc_cache = {
    "encodings": [],  # list of numpy arrays
    "names": [],      # parallel list of names
    "face_files": []  # filenames for traceability
}

def rebuild_encoding_cache():
    """Rebuild in-memory encoding cache from face image files."""
    global enc_cache
    enc_cache = {"encodings": [], "names": [], "face_files": []}
    users_data = load_users()
    users = users_data.get("users", [])
    for user in users:
        face_file = user.get("face_image")
        if not face_file: continue
        face_path = os.path.join(FACES_DIR, face_file)
        if not os.path.exists(face_path):
            print(f"[cache] Missing face file for {user['name']}: {face_path}")
            continue
        try:
            pil_img = Image.open(face_path).convert('RGB')
            rgb = np.array(pil_img)
            enc = get_face_encoding(rgb)
            if enc is not None:
                enc_cache["encodings"].append(enc)
                enc_cache["names"].append(user['name'])
                enc_cache["face_files"].append(face_file)
        except Exception as e:
            print(f"[cache] Failed encoding for {user['name']}: {e}")

def get_cached_match(encoding, tolerance=0.60):
    if encoding is None or not enc_cache["encodings"]:
        return None, None
    try:
        distances = face_recognition.face_distance(enc_cache["encodings"], encoding)
        if len(distances):
            min_d = float(np.min(distances))
            if min_d <= tolerance:
                idx = int(np.argmin(distances))
                return enc_cache["names"][idx], min_d
    except Exception as e:
        print(f"[match] Error computing distance: {e}")
    return None, None

def ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(FACES_DIR, exist_ok=True)
    if not os.path.exists(USERS_DB):
        with open(USERS_DB, "w", encoding="utf-8") as f:
            json.dump({"users": []}, f, ensure_ascii=False, indent=2)
    if not os.path.exists(ATTENDANCE_DB):
        with open(ATTENDANCE_DB, "w", encoding="utf-8") as f:
            json.dump({"records": []}, f, ensure_ascii=False, indent=2)

def load_users():
    ensure_data_files()
    with open(USERS_DB, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

def save_users(data):
    with open(USERS_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_attendance():
    ensure_data_files()
    with open(ATTENDANCE_DB, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data

def save_attendance(data):
    with open(ATTENDANCE_DB, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def init_yolo():
    global yolo_model
    if YOLO is None:
        return False
    try:
        # Load YOLOv8n model - akan auto-download jika belum ada
        yolo_model = YOLO('yolov8n-face.pt')  # face detection model
        print("✓ YOLO face detection model loaded successfully")
        return True
    except Exception as e:
        try:
            # Fallback ke standard YOLOv8n dan filter class 0 (person)
            yolo_model = YOLO('yolov8n.pt')
            print("✓ YOLO standard model loaded (will detect person/face)")
            return True
        except Exception as e2:
            print(f"✗ Failed to load YOLO model: {e2}")
            return False





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


def get_face_encoding(image_rgb, box=None):
    """Extract 128-d face encoding from image. If box provided, use it; otherwise detect face."""
    if face_recognition is None or np is None:
        return None
    try:
        if box:
            # Use provided box location
            face_location = (box['top'], box['right'], box['bottom'], box['left'])
            encodings = face_recognition.face_encodings(image_rgb, known_face_locations=[face_location])
        else:
            # Auto-detect face in image
            encodings = face_recognition.face_encodings(image_rgb)
        
        if encodings:
            return encodings[0]
        return None
    except Exception as e:
        print(f"Encoding error: {e}")
        return None


def load_face_encodings_from_files():
    """Load all face encodings from saved face images."""
    users_data = load_users()
    users = users_data.get("users", [])
    
    known_encodings = []
    known_names = []
    
    for user in users:
        face_file = user.get("face_image")
        if not face_file:
            continue
        
        face_path = os.path.join(FACES_DIR, face_file)
        if not os.path.exists(face_path):
            print(f"Warning: Face image not found for {user['name']}: {face_path}")
            continue
        
        try:
            # Load image using Pillow first, then convert to numpy
            from PIL import Image as PILImage
            pil_image = PILImage.open(face_path)
            image = np.array(pil_image.convert('RGB'))
            
            encoding = get_face_encoding(image)
            if encoding is not None:
                known_encodings.append(encoding)
                known_names.append(user["name"])
        except Exception as e:
            print(f"Error loading face for {user['name']}: {e}")
    
    return known_encodings, known_names


def match_face(encoding, tolerance=0.55):
    """Compare encoding against registered users from face image files. Returns (name, distance) or (None, None)."""
    if encoding is None:
        return None, None
    # Prefer cached encodings for speed
    name, dist = get_cached_match(encoding, tolerance=tolerance)
    if name:
        return name, dist
    # Fallback rebuild cache once then retry
    rebuild_encoding_cache()
    return get_cached_match(encoding, tolerance=tolerance)


def detect_faces_yolo(image_rgb, conf_threshold=0.25):
    """Detect faces using YOLO model. Returns list of bounding boxes."""
    if yolo_model is None:
        return []
    try:
        # YOLO expects BGR format
        image_bgr = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)

        # Run inference
        results = yolo_model(image_bgr, conf=conf_threshold, verbose=False)

        boxes = []
        for result in results:
            if result.boxes is not None:
                for box in result.boxes:
                    # Get coordinates (x1, y1, x2, y2)
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                    conf = float(box.conf[0])

                    # Convert to (top, right, bottom, left) format
                    boxes.append({
                        'top': int(y1),
                        'right': int(x2),
                        'bottom': int(y2),
                        'left': int(x1),
                        'confidence': conf
                    })

        if not boxes:
            print(f"[detect] No faces (conf={conf_threshold}) size={image_rgb.shape}")
        else:
            print(f"[detect] Detected {len(boxes)} face(s) conf>={conf_threshold}")
        return boxes
    except Exception as e:
        print(f"YOLO detection error: {e}")
        return []

def detect_faces_fallback(image_rgb):
    """Fallback face detection using face_recognition if YOLO gives no faces.
    Returns list of boxes in same dict format. Confidence is mocked as 1.0."""
    if face_recognition is None:
        return []
    try:
        locations = face_recognition.face_locations(image_rgb, number_of_times_to_upsample=1, model='hog')
        boxes = []
        for (top, right, bottom, left) in locations:
            boxes.append({
                'top': int(top),
                'right': int(right),
                'bottom': int(bottom),
                'left': int(left),
                'confidence': 1.0
            })
        if boxes:
            print(f"[fallback] face_recognition located {len(boxes)} face(s)")
        return boxes
    except Exception as e:
        print(f"[fallback] error: {e}")
        return []

def detect_faces_haar(image_rgb):
    """Additional fallback using OpenCV Haar cascade when other detectors fail."""
    if cv2 is None:
        return []
    try:
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
        cascade_path = os.path.join(cv2.data.haarcascades, 'haarcascade_frontalface_default.xml')
        if not os.path.exists(cascade_path):
            return []
        clf = cv2.CascadeClassifier(cascade_path)
        faces = clf.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(50, 50))
        boxes = []
        for (x, y, w, h) in faces:
            boxes.append({
                'top': int(y),
                'right': int(x + w),
                'bottom': int(y + h),
                'left': int(x),
                'confidence': 0.9
            })
        if boxes:
            print(f"[haar] detected {len(boxes)} face(s)")
        return boxes
    except Exception as e:
        print(f"[haar] error: {e}")
        return []

def detect_faces(image_rgb, conf_threshold=0.25):
    """Primary detection pipeline: YOLO then fallback to face_recognition if none."""
    boxes = detect_faces_yolo(image_rgb, conf_threshold)
    if not boxes:
        boxes = detect_faces_fallback(image_rgb)
    if not boxes:
        boxes = detect_faces_haar(image_rgb)
    return boxes

def compute_liveness(image_rgb, boxes, session_id):
    """Compute simple liveness heuristics per face box.
    Heuristics:
      - Variance of Laplacian (focus / texture)
      - Inter-frame motion energy in ROI
    Classification rule (naive): live if (motion > motion_thresh) OR (lap_var > lap_thresh)
    Stores previous grayscale ROIs per session for temporal motion.
    """
    if cv2 is None or np is None:
        # Cannot compute liveness without cv2/numpy
        return [{"live": True, "lap_var": 0.0, "motion": 0.0} for _ in boxes]

    # Thresholds (tunable)
    lap_thresh = 80.0       # below this likely too flat/blurry (possible print/screen)
    motion_thresh = 2.5     # mean absolute diff threshold
    min_area = 25 * 25      # ignore very tiny boxes

    # Session state init
    state = liveness_sessions.get(session_id, {"prev_rois": []})
    prev_rois = state.get("prev_rois", [])

    current_rois = []
    results = []

    # Process boxes sorted left->right for stable ordering (index based matching)
    ordered_boxes = sorted(enumerate(boxes), key=lambda x: x[1]['left'])
    index_map = {orig_i: new_i for new_i, (orig_i, _) in enumerate(ordered_boxes)}

    # Extract grayscale ROIs
    gray_full = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)

    for orig_i, box in ordered_boxes:
        top, right, bottom, left = box['top'], box['right'], box['bottom'], box['left']
        # Clamp
        h, w = gray_full.shape
        top = max(0, top); bottom = min(h, bottom); left = max(0, left); right = min(w, right)
        roi = gray_full[top:bottom, left:right]
        area = roi.shape[0] * roi.shape[1]
        if area == 0:
            lap_var = 0.0
            motion = 0.0
            live = False
            current_rois.append(None)
            results.append((orig_i, {"live": live, "lap_var": lap_var, "motion": motion}))
            continue

        # Resize ROI to fixed small size for stable Laplacian & motion
        target_size = 100
        roi_resized = cv2.resize(roi, (target_size, target_size), interpolation=cv2.INTER_AREA)

        lap = cv2.Laplacian(roi_resized, cv2.CV_64F)
        lap_var = float(lap.var())

        # Motion energy vs previous roi
        motion = 0.0
        prev = prev_rois[index_map[orig_i]] if index_map[orig_i] < len(prev_rois) else None
        if prev is not None:
            # compute mean abs diff
            diff = cv2.absdiff(roi_resized, prev)
            motion = float(np.mean(diff))

        current_rois.append(roi_resized)

        # Classification
        live = (area >= min_area) and ((motion > motion_thresh) or (lap_var > lap_thresh))
        results.append((orig_i, {"live": live, "lap_var": lap_var, "motion": motion}))

    # Reorder to original sequence
    ordered_results = sorted(results, key=lambda x: x[0])
    liveness_info = [r for _, r in ordered_results]

    # Save state
    liveness_sessions[session_id] = {"prev_rois": current_rois}
    return liveness_info



@app.route("/")
def root():
    # Serve index.html
    return send_from_directory(PUBLIC_DIR, "index.html")


@app.route("/register")
def register_page():
    return send_from_directory(PUBLIC_DIR, "register.html")


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok", 
        "yolo_loaded": yolo_model is not None,
        "model_type": "YOLOv8" if yolo_model is not None else "none"
    })


@app.route("/api/users", methods=["GET"]) 
def list_users():
    users_data = load_users()
    users_list = [{"name": u["name"]} for u in users_data.get("users", [])]
    return jsonify({"ok": True, "users": users_list})


@app.route("/api/register", methods=["POST"]) 
def api_register():
    if face_recognition is None:
        return jsonify({"ok": False, "error": "face_recognition not installed"}), 500
    
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "").strip()
    image_b64 = payload.get("image")
    
    if not name:
        return jsonify({"ok": False, "error": "Nama tidak boleh kosong."}), 400
    if not image_b64:
        return jsonify({"ok": False, "error": "Gambar tidak ditemukan."}), 400

    try:
        rgb = decode_image_to_rgb(image_b64)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    try:
        # Detect faces using YOLO first
        boxes = detect_faces_yolo(rgb, conf_threshold=0.5)
        if not boxes:
            return jsonify({"ok": False, "error": "Tidak ada wajah terdeteksi. Pastikan wajah terlihat jelas."}), 400
        
        # Check encoding
        encoding = get_face_encoding(rgb)
        if encoding is None:
            return jsonify({"ok": False, "error": "Gagal mengekstrak fitur wajah."}), 400

        users_data = load_users()
        users = users_data.get("users", [])
        
        # Check if name already exists
        for user in users:
            if user["name"].lower() == name.lower():
                return jsonify({"ok": False, "error": f"Nama '{name}' sudah terdaftar."}), 400
        
        # Save face image as JPG file
        import time
        timestamp = int(time.time())
        filename = f"{name.lower().replace(' ', '_')}_{timestamp}.jpg"
        filepath = os.path.join(FACES_DIR, filename)
        
        # Save using Pillow (more reliable for RGB)
        from PIL import Image as PILImage
        pil_image = PILImage.fromarray(rgb)
        pil_image.save(filepath, 'JPEG', quality=95)
        
        # Save only name and filename reference in JSON
        users.append({"name": name, "face_image": filename})
        users_data["users"] = users
        save_users(users_data)
        rebuild_encoding_cache()  # refresh cache immediately
        
        return jsonify({"ok": True, "message": f"Berhasil mendaftarkan {name}!"})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal registrasi: {e}"}), 500


@app.route("/api/attendance", methods=["POST"])
def api_attendance():
    """Record attendance for recognized person."""
    payload = request.get_json(silent=True) or {}
    name = payload.get("name", "").strip()
    
    if not name:
        return jsonify({"ok": False, "error": "Nama tidak ditemukan"}), 400
    
    try:
        from datetime import datetime
        attendance_data = load_attendance()
        records = attendance_data.get("records", [])
        
        timestamp = datetime.now().isoformat()
        record = {
            "name": name,
            "timestamp": timestamp,
            "date": datetime.now().strftime("%Y-%m-%d"),
            "time": datetime.now().strftime("%H:%M:%S")
        }
        
        records.append(record)
        attendance_data["records"] = records
        save_attendance(attendance_data)
        
        return jsonify({"ok": True, "message": f"Absensi {name} tercatat", "record": record})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal mencatat absensi: {e}"}), 500


@app.route("/api/attendance", methods=["GET"])
def get_attendance():
    """Get attendance records."""
    try:
        attendance_data = load_attendance()
        records = attendance_data.get("records", [])
        
        # Get date filter if provided
        date_filter = request.args.get("date")
        if date_filter:
            records = [r for r in records if r.get("date") == date_filter]
        
        return jsonify({"ok": True, "records": records, "count": len(records)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal membaca data: {e}"}), 500



@app.route("/api/detect", methods=["POST"]) 
def api_detect():
    payload = request.get_json(silent=True) or {}
    image_b64 = payload.get("image")
    conf_threshold = float(payload.get("confidence", 0.3))
    session_id = str(payload.get("sessionId", "default"))
    
    if not image_b64:
        return jsonify({"ok": False, "error": "Gambar tidak ditemukan."}), 400

    try:
        rgb = decode_image_to_rgb(image_b64)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    try:
        # Detect faces (YOLO with fallback)
        boxes = detect_faces(rgb, conf_threshold)

        # Compute liveness info per box
        liveness_info = compute_liveness(rgb, boxes, session_id)

        # Format results (attach liveness metrics + name recognition)
        results = []
        for box, live_info in zip(boxes, liveness_info):
            # Only attempt recognition if face is live
            name = None
            distance = None
            if live_info['live']:
                encoding = get_face_encoding(rgb, box)
                if encoding is not None:
                    name, distance = match_face(encoding, tolerance=0.62)
            
            results.append({
                "box": {
                    "top": box['top'],
                    "right": box['right'],
                    "bottom": box['bottom'],
                    "left": box['left']
                },
                "confidence": box['confidence'],
                "liveness": live_info,
                "name": name,
                "distance": distance
            })

        return jsonify({"ok": True, "faces": results, "count": len(results)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Gagal mendeteksi: {e}"}), 500

@app.route("/api/debug/status")
def debug_status():
    """Return diagnostic information about model and cache."""
    return jsonify({
        "ok": True,
        "yolo_loaded": yolo_model is not None,
        "cached_count": len(enc_cache.get("encodings", [])),
        "cached_names": enc_cache.get("names", []),
        "faces_dir_exists": os.path.isdir(FACES_DIR),
        "users_count": len(load_users().get("users", []))
    })

@app.route("/api/debug/encodings", methods=["POST"])
def debug_encodings():
    """Given an image base64, return distances to cached encodings for troubleshooting."""
    payload = request.get_json(silent=True) or {}
    image_b64 = payload.get("image")
    if not image_b64:
        return jsonify({"ok": False, "error": "image base64 missing"}), 400
    try:
        rgb = decode_image_to_rgb(image_b64)
        box_enc = get_face_encoding(rgb)
        if box_enc is None:
            return jsonify({"ok": False, "error": "no face encoding extracted"}), 400
        distances = []
        if enc_cache["encodings"]:
            raw = face_recognition.face_distance(enc_cache["encodings"], box_enc)
            distances = [float(d) for d in raw]
        return jsonify({
            "ok": True,
            "input_encoding": True,
            "cached_names": enc_cache["names"],
            "distances": distances
        })
    except Exception as e:
        return jsonify({"ok": False, "error": f"debug failure: {e}"}), 500



if __name__ == "__main__":
    print("=" * 50)
    print("Starting Face Detection Server with YOLO")
    print("=" * 50)
    
    # Initialize YOLO model
    if init_yolo():
        print("✓ Server ready")
        rebuild_encoding_cache()
    else:
        print("⚠ Warning: YOLO model failed to load")
        print("  Server will start but detection may not work")
    
    port = int(os.environ.get("PORT", 5000))
    print(f"\n➜ Local: http://localhost:{port}")
    print("=" * 50)
    app.run(host="0.0.0.0", port=port, debug=True)
