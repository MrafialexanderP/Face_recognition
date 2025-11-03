(function(){
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const hiAcc = document.getElementById('hiAcc');

  let stream = null;
  let timer = null;
  let running = false;
  let sessionId = 0; // meningkat setiap start agar respons lama bisa diabaikan
  let currentController = null; // untuk membatalkan fetch yang sedang berjalan
  let captureCanvas = document.createElement('canvas');
  let captureCtx = captureCanvas.getContext('2d');
  let overlayCtx = overlay.getContext('2d');

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
      setStatus('❌ Gagal mengakses kamera: ' + err.message);
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
    setStatus('🛑 Kamera berhenti.');
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

  function smoothBox(newBox, oldBox, alpha = 0.3) {
    // Linear interpolation untuk smooth movement
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
    
    for (let i = 0; i < faces.length; i++){
      const f = faces[i];
      // ID berdasarkan index dan posisi untuk tracking
      const faceId = 'face_' + i + '_' + Math.round(f.box.left / 50);
      const smoothed = smoothBox(f.box, smoothedBoxes[faceId], 0.4);
      newSmoothedBoxes[faceId] = smoothed;
      
      const b = smoothed;
      
      // Kotak hijau dengan glow effect
      overlayCtx.strokeStyle = '#00FF00';
      overlayCtx.shadowColor = 'rgba(0,255,0,0.6)';
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
      const label = `Face #${i + 1}`;
      const labelWidth = overlayCtx.measureText(label).width + 20;
      const labelHeight = 30;
      
      // Label background dengan gradient
      const gradient = overlayCtx.createLinearGradient(b.left, b.top - labelHeight, b.left, b.top);
      gradient.addColorStop(0, 'rgba(0,255,0,0.95)');
      gradient.addColorStop(1, 'rgba(0,200,0,0.95)');
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
    }
    
    smoothedBoxes = newSmoothedBoxes;
    
    if (faces.length === 1){ 
      setStatus('✅ Terdeteksi 1 wajah'); 
    } else if (faces.length > 1) { 
      setStatus(`✅ Terdeteksi ${faces.length} wajah`); 
    } else { 
      setStatus('🔍 Mencari wajah...'); 
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
    const scale = 0.5; // proses di 50% ukuran untuk kecepatan
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
      const resp = await fetch('/api/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, model: hiAcc && hiAcc.checked ? 'cnn' : 'auto' }),
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
        }
      }));
      
      if (scaledFaces.length){
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
      }
    } catch(err){
      if (err.name === 'AbortError') return; // diabaikan saat berhenti
      console.error(err);
      if (running) setStatus('❌ Gagal mendeteksi: ' + err.message);
    }
  }

  function startRecognitionLoop(){
    if (timer) clearInterval(timer);
    // Delay awal untuk memastikan video ready
    setTimeout(() => {
      if (running && stream) {
        // Interval lebih cepat untuk tracking yang smooth (150ms = ~6-7 FPS)
        timer = setInterval(recognizeOnce, 150);
        // Trigger pertama kali langsung
        recognizeOnce();
      }
    }, 500);
  }

  window.addEventListener('resize', resizeCanvases);
  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
})();
