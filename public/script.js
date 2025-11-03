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
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      // Wait for video to be ready
      await new Promise(res => video.onloadedmetadata = res);
      resizeCanvases();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      running = true;
      sessionId++;
      startRecognitionLoop();
      setStatus('Kamera aktif.');
    } catch(err){
      console.error(err);
      setStatus('Gagal mengakses kamera: ' + err.message);
    }
  }

  function stopCamera(){
    running = false;
    if (timer){ clearInterval(timer); timer = null; }
    if (currentController){ try { currentController.abort(); } catch(_) {} currentController = null; }
    if (stream){ stream.getTracks().forEach(t => t.stop()); stream = null; }
    startBtn.disabled = false;
    stopBtn.disabled = true;
    overlayCtx.clearRect(0,0,overlay.width, overlay.height);
    setStatus('Kamera berhenti.');
  }

  function resizeCanvases(){
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    overlay.width = w; overlay.height = h;
    captureCanvas.width = w; captureCanvas.height = h;
  }

  let lastFaces = [];
  let lastFacesAt = 0;

  function drawResults(faces){
    overlayCtx.clearRect(0,0,overlay.width, overlay.height);
    overlayCtx.lineWidth = 2;
    overlayCtx.font = '16px system-ui';
    overlayCtx.strokeStyle = '#00FF00';
    overlayCtx.fillStyle = 'rgba(0,0,0,0.5)';
    const names = [];
    for (const f of faces){
      const b = f.box;
      overlayCtx.strokeStyle = f.name === 'Unknown' ? '#ff4d4f' : '#00FF00';
      overlayCtx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
      const label = `${f.name}${f.distance != null ? ` (${f.distance.toFixed(2)})` : ''}`;
      overlayCtx.fillStyle = 'rgba(0,0,0,0.6)';
      overlayCtx.fillRect(b.left, b.top - 22, overlayCtx.measureText(label).width + 10, 20);
      overlayCtx.fillStyle = '#fff';
      overlayCtx.fillText(label, b.left + 5, b.top - 7);
      names.push(f.name);
    }
    if (faces.length){ setStatus('Terdeteksi: ' + names.join(', ')); }
    else { setStatus('Tidak ada wajah terdeteksi.'); }
  }

  async function recognizeOnce(){
    if (!stream || !running) return;
    captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1];
    try {
      const controller = new AbortController();
      currentController = controller;
      const mySession = sessionId;
      const resp = await fetch('/api/recognize', {
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
      if (faces.length){
        lastFaces = faces;
        lastFacesAt = Date.now();
        drawResults(faces);
      } else {
        // smoothing: jika kosong, tampilkan hasil terakhir <=500ms agar tidak flicker
        if (Date.now() - lastFacesAt <= 500){
          drawResults(lastFaces);
        } else {
          drawResults([]);
        }
      }
    } catch(err){
      if (err.name === 'AbortError') return; // diabaikan saat berhenti
      console.error(err);
      if (running) setStatus('Gagal mengenali: ' + err.message);
    }
  }

  function startRecognitionLoop(){
    if (timer) clearInterval(timer);
    // Percepat agar kotak lebih mengikuti pergerakan wajah
    timer = setInterval(recognizeOnce, 300);
  }

  window.addEventListener('resize', resizeCanvases);
  startBtn.addEventListener('click', startCamera);
  stopBtn.addEventListener('click', stopCamera);
})();
