(function(){
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const confSlider = document.getElementById('confSlider');
  const confLabel = document.getElementById('confLabel');
  const attendanceLog = document.getElementById('attendanceLog');

  let stream = null;
  let timer = null;
  let running = false;
  let sessionId = 0; // meningkat setiap start agar respons lama bisa diabaikan
  let currentController = null; // untuk membatalkan fetch yang sedang berjalan
  let captureCanvas = document.createElement('canvas');
  let captureCtx = captureCanvas.getContext('2d');
  let overlayCtx = overlay.getContext('2d');
  let recentAttendance = new Set(); // Track recently logged attendance to avoid duplicates

  function setStatus(msg){ statusEl.textContent = msg; }

  async function startCamera(){
    try {
      // Clear previous state
      if (timer) clearInterval(timer);
      if (currentController) { try { currentController.abort(); } catch(_) {} }
      if (stream) { stream.getTracks().forEach(t => t.stop()); }
      
      // Reset smoothing data
      lastFaces = [];
      lastFacesAt = 0;
      smoothedBoxes = {};
      faceIds = {};
      recentAttendance.clear();
      overlayCtx.clearRect(0,0,overlay.width, overlay.height);
      
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      // Wait for video to be ready
      await new Promise(res => video.onloadedmetadata = res);
      resizeCanvases();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      running = true;
      sessionId++;
      setStatus('⏳ Memulai deteksi...');
      startRecognitionLoop();
    } catch(err){
      console.error(err);
      setStatus('✗ Camera access denied');
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  function stopCamera(){
    running = false;
    if (timer){ clearInterval(timer); timer = null; }
    if (currentController){ try { currentController.abort(); } catch(_) {} currentController = null; }
    if (stream){ 
      stream.getTracks().forEach(t => t.stop()); 
      stream = null; 
    }
    video.srcObject = null; // Clear video source
    startBtn.disabled = false;
    stopBtn.disabled = true;
    overlayCtx.clearRect(0,0,overlay.width, overlay.height);
    // Reset smoothing data
    lastFaces = [];
    lastFacesAt = 0;
    smoothedBoxes = {};
    faceIds = {};
    recentAttendance.clear();
    setStatus('⏸ Stopped');
  }

  function resizeCanvases(){
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    overlay.width = w; overlay.height = h;
    captureCanvas.width = w; captureCanvas.height = h;
  }

  let lastFaces = [];
  let lastFacesAt = 0;
  let smoothedBoxes = {}; // untuk smooth tracking per wajah
  let faceIds = {}; // Track face IDs for better matching across frames

  function calculateIOU(box1, box2) {
    // Calculate Intersection over Union for box matching
    const xA = Math.max(box1.left, box2.left);
    const yA = Math.max(box1.top, box2.top);
    const xB = Math.min(box1.right, box2.right);
    const yB = Math.min(box1.bottom, box2.bottom);
    
    const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const box1Area = (box1.right - box1.left) * (box1.bottom - box1.top);
    const box2Area = (box2.right - box2.left) * (box2.bottom - box2.top);
    
    const unionArea = box1Area + box2Area - interArea;
    return unionArea > 0 ? interArea / unionArea : 0;
  }

  function matchFaceToId(newBox, prevFaces) {
    // Match current face box to previous frame using IOU
    let bestMatch = null;
    let bestIOU = 0.3; // Minimum IOU threshold
    
    for (let prevFace of prevFaces) {
      const iou = calculateIOU(newBox, prevFace.box);
      if (iou > bestIOU) {
        bestIOU = iou;
        bestMatch = prevFace.id;
      }
    }
    
    return bestMatch;
  }

  function smoothBox(newBox, oldBox, alpha = 0.5) {
    // Linear interpolation untuk smooth movement dengan alpha lebih tinggi
    if (!oldBox) return newBox;
    return {
      top: Math.round(oldBox.top + (newBox.top - oldBox.top) * alpha),
      right: Math.round(oldBox.right + (newBox.right - oldBox.right) * alpha),
      bottom: Math.round(oldBox.bottom + (newBox.bottom - oldBox.bottom) * alpha),
      left: Math.round(oldBox.left + (newBox.left - oldBox.left) * alpha)
    };
  }

  function drawResults(faces){
    overlayCtx.clearRect(0,0,overlay.width, overlay.height);
    overlayCtx.lineWidth = 3;
    overlayCtx.font = 'bold 18px system-ui';
    
    const newSmoothedBoxes = {};
    const currentFaces = [];
    
    for (let i = 0; i < faces.length; i++){
      const f = faces[i];
      
      // Match face to previous frame using IOU
      const prevFaceData = lastFaces.length > 0 ? lastFaces : [];
      let faceId = matchFaceToId(f.box, prevFaceData);
      
      // If no match found, create new ID
      if (!faceId) {
        faceId = 'face_' + Date.now() + '_' + i;
      }
      
      // Apply smoothing using tracked ID
      const smoothed = smoothBox(f.box, smoothedBoxes[faceId], 0.6);
      newSmoothedBoxes[faceId] = smoothed;
      
      const b = smoothed;
      const isLive = f.liveness && f.liveness.live;
      const strokeColor = isLive ? '#00FF00' : '#FF2D2D';
      const shadowColor = isLive ? 'rgba(0,255,0,0.6)' : 'rgba(255,50,50,0.6)';
      
      // Kotak dengan glow effect (hijau jika live, merah jika spoof)
      overlayCtx.strokeStyle = strokeColor;
      overlayCtx.shadowColor = shadowColor;
      overlayCtx.shadowBlur = 15;
      
      // Draw rounded rectangle
      const radius = 12;
      overlayCtx.beginPath();
      overlayCtx.moveTo(b.left + radius, b.top);
      overlayCtx.lineTo(b.right - radius, b.top);
      overlayCtx.quadraticCurveTo(b.right, b.top, b.right, b.top + radius);
      overlayCtx.lineTo(b.right, b.bottom - radius);
      overlayCtx.quadraticCurveTo(b.right, b.bottom, b.right - radius, b.bottom);
      overlayCtx.lineTo(b.left + radius, b.bottom);
      overlayCtx.quadraticCurveTo(b.left, b.bottom, b.left, b.bottom - radius);
      overlayCtx.lineTo(b.left, b.top + radius);
      overlayCtx.quadraticCurveTo(b.left, b.top, b.left + radius, b.top);
      overlayCtx.closePath();
      overlayCtx.stroke();
      
      overlayCtx.shadowBlur = 0;
      
      // Label "Face Detected"
      const name = f.name || null;
      let label = '';
      
      if (name && isLive) {
        label = `${name}`;
        // Auto log attendance for recognized live faces
        logAttendance(name);
      } else if (isLive) {
        label = `Unknown #${i + 1}`;
      } else {
        label = `SPOOF? #${i + 1}`;
      }
      
      const labelWidth = overlayCtx.measureText(label).width + 20;
      const labelHeight = 30;
      
      // Label background dengan gradient
      const gradient = overlayCtx.createLinearGradient(b.left, b.top - labelHeight, b.left, b.top);
      if (isLive) {
        gradient.addColorStop(0, 'rgba(0,255,0,0.95)');
        gradient.addColorStop(1, 'rgba(0,200,0,0.95)');
      } else {
        gradient.addColorStop(0, 'rgba(255,70,70,0.95)');
        gradient.addColorStop(1, 'rgba(200,40,40,0.95)');
      }
      overlayCtx.fillStyle = gradient;
      
      overlayCtx.beginPath();
      overlayCtx.moveTo(b.left, b.top - labelHeight);
      overlayCtx.lineTo(b.left + labelWidth, b.top - labelHeight);
      overlayCtx.lineTo(b.left + labelWidth, b.top);
      overlayCtx.lineTo(b.left, b.top);
      overlayCtx.closePath();
      overlayCtx.fill();
      
      // Label text
      overlayCtx.fillStyle = '#fff';
      overlayCtx.shadowColor = 'rgba(0,0,0,0.5)';
      overlayCtx.shadowBlur = 3;
      overlayCtx.fillText(label, b.left + 10, b.top - 8);
      overlayCtx.shadowBlur = 0;
      
      // Store for next frame matching
      currentFaces.push({
        id: faceId,
        box: smoothed,
        name: name
      });
    }
    
    smoothedBoxes = newSmoothedBoxes;
    lastFaces = currentFaces;
    
    // Count recognized vs unknown
    const recognized = faces.filter(f => f.name && f.liveness && f.liveness.live).length;
    const unknown = faces.filter(f => !f.name && f.liveness && f.liveness.live).length;
    const spoof = faces.filter(f => f.liveness && !f.liveness.live).length;
    
    if (recognized > 0){
      setStatus(`✅ ${recognized} wajah dikenali`);
    } else if (unknown > 0) { 
      setStatus(`👤 ${unknown} wajah tidak dikenal`); 
    } else if (spoof > 0) {
      setStatus(`⚠️ ${spoof} wajah palsu terdeteksi`);
    } else { 
      setStatus('🔍 Mencari wajah...'); 
    }
  }

  async function logAttendance(name) {
    // Avoid duplicate logs within 60 seconds
    if (recentAttendance.has(name)) return;
    
    try {
      const resp = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name })
      });
      const data = await resp.json();
      if (data.ok) {
        recentAttendance.add(name);
        // Clear from set after 60 seconds
        setTimeout(() => recentAttendance.delete(name), 60000);
        // Update attendance log if element exists
        if (attendanceLog) {
          updateAttendanceLog();
        }
      }
    } catch(err) {
      console.error('Attendance log error:', err);
    }
  }

  async function updateAttendanceLog() {
    if (!attendanceLog) return;
    try {
      const resp = await fetch('/api/attendance');
      const data = await resp.json();
      if (data.ok && data.records) {
        // Show last 5 records
        const recent = data.records.slice(-5).reverse();
        attendanceLog.innerHTML = recent.map(r => 
          `<div class="log-entry">
            <span class="log-name">${r.name}</span>
            <span class="log-time">${r.time}</span>
          </div>`
        ).join('');
      }
    } catch(err) {
      console.error('Failed to fetch attendance:', err);
    }
  }

  async function recognizeOnce(){
    if (!stream || !running) return;
    
    // Check if video is ready
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      console.log('Video not ready yet...');
      return;
    }
    
    // Kurangi ukuran gambar untuk processing lebih cepat
    // Adaptive scale: start at 0.6, increase to 1.0 if many misses
    if (typeof window.__adaptiveMisses === 'undefined') window.__adaptiveMisses = 0;
    let baseScale = 0.6;
    if (window.__adaptiveMisses >= 15) baseScale = 1.0; else if (window.__adaptiveMisses >= 8) baseScale = 0.8;
    const scale = baseScale;
    const w = Math.floor(captureCanvas.width * scale);
    const h = Math.floor(captureCanvas.height * scale);
    
    if (w <= 0 || h <= 0) {
      console.log('Invalid dimensions:', w, h);
      return;
    }
    
    // Temporary canvas untuk resize
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    const tempCtx = tempCanvas.getContext('2d');
    
    try {
      tempCtx.drawImage(video, 0, 0, w, h);
    } catch(e) {
      console.error('Failed to draw video frame:', e);
      return;
    }
    
    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.75); // quality lebih rendah untuk speed
    const base64 = dataUrl.split(',')[1];
    
    try {
      const controller = new AbortController();
      currentController = controller;
      const mySession = sessionId;
      let confidence = confSlider ? parseFloat(confSlider.value) / 100 : 0.3;
      // Lower confidence threshold adaptively after many misses
      if (window.__adaptiveMisses >= 15 && confidence > 0.15) confidence = 0.15;
      else if (window.__adaptiveMisses >= 8 && confidence > 0.22) confidence = 0.22;
      const resp = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, confidence: confidence, sessionId: mySession }),
        signal: controller.signal
      });
      const data = await resp.json();
      // Jika sesi sudah berubah atau running=false, abaikan hasil ini (mencegah kotak tersisa setelah stop)
      if (!running || mySession !== sessionId) return;
      if (!data.ok){ throw new Error(data.error || 'Unknown error'); }
      
      const faces = data.faces || [];
      // Scale kembali koordinat box ke ukuran asli
      const scaledFaces = faces.map(f => ({
        ...f,
        box: {
          top: Math.round(f.box.top / scale),
          right: Math.round(f.box.right / scale),
          bottom: Math.round(f.box.bottom / scale),
          left: Math.round(f.box.left / scale)
        },
        liveness: f.liveness || { live: true },
        name: f.name || null
      }));
      
      if (scaledFaces.length){
        window.__adaptiveMisses = 0; // reset on success
        lastFaces = scaledFaces;
        lastFacesAt = Date.now();
        drawResults(scaledFaces);
      } else {
        // smoothing: jika kosong, tampilkan hasil terakhir <=700ms agar tidak flicker
        if (Date.now() - lastFacesAt <= 700){
          drawResults(lastFaces);
        } else {
          drawResults([]);
        }
        window.__adaptiveMisses++;
      }
    } catch(err){
      if (err.name === 'AbortError') return; // diabaikan saat berhenti
      console.error(err);
      if (running) setStatus('✗ Detection failed');
    }
  }

  function startRecognitionLoop(){
    if (timer) clearInterval(timer);
    // Delay awal untuk memastikan video ready
    setTimeout(() => {
      if (running && stream) {
        // Interval 100ms untuk real-time detection (~10 FPS)
        timer = setInterval(recognizeOnce, 100);
        // Trigger pertama kali langsung
        recognizeOnce();
      }
    }, 500);
  }

  window.addEventListener('resize', resizeCanvases);
  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
  
  if (confSlider) {
    confSlider.addEventListener('input', (e) => {
      confLabel.textContent = `Confidence: ${e.target.value}%`;
    });
  }

  // Load attendance log on page load
  if (attendanceLog) {
    updateAttendanceLog();
    // Refresh every 10 seconds
    setInterval(updateAttendanceLog, 10000);
  }
})();
