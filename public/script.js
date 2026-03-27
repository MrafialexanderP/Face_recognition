(function(){
  const video = document.getElementById('video');
  const overlay = document.getElementById('overlay');
  const statusEl = document.getElementById('status');
  const startBtn = document.getElementById('startBtn');
  const captureBtn = document.getElementById('captureBtn');
  const stopBtn = document.getElementById('stopBtn');
  const hiAcc = document.getElementById('hiAcc');

  let stream = null;
  let captureCanvas = document.createElement('canvas');
  let captureCtx = captureCanvas.getContext('2d');
  let overlayCtx = overlay.getContext('2d');

  async function parseApiResponse(resp){
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch (_err) {
      throw new Error(`Server returned non-JSON response (status ${resp.status}).`);
    }
  }

  function setStatus(msg){ statusEl.textContent = msg; }

  async function startCamera(){
    try {
      if (stream) { 
        stream.getTracks().forEach(t => t.stop()); 
      }
      
      overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
      
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      await new Promise(res => video.onloadedmetadata = res);
      resizeCanvases();
      
      startBtn.disabled = true;
      captureBtn.disabled = false;
      stopBtn.disabled = false;
      setStatus('📹 Kamera aktif. Posisikan wajah Anda dan klik Capture.');
    } catch(err){
      console.error(err);
      setStatus('❌ Gagal mengakses kamera: ' + err.message);
      startBtn.disabled = false;
      captureBtn.disabled = true;
      stopBtn.disabled = true;
    }
  }

  function stopCamera(){
    if (stream){ 
      stream.getTracks().forEach(t => t.stop()); 
      stream = null; 
    }
    video.srcObject = null;
    startBtn.disabled = false;
    captureBtn.disabled = true;
    stopBtn.disabled = true;
    overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
    setStatus('🛑 Kamera berhenti.');
  }

  function resizeCanvases(){
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    overlay.width = w; 
    overlay.height = h;
    captureCanvas.width = w; 
    captureCanvas.height = h;
  }

  async function captureAndRecognize(){
    if (!stream){ 
      setStatus('Kamera belum aktif.'); 
      return; 
    }
    
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      setStatus('⏳ Menunggu video siap...');
      return;
    }
    
    // Disable buttons
    captureBtn.disabled = true;
    stopBtn.disabled = true;
    setStatus('⏳ Memproses wajah...');
    
    try {
      // Capture frame
      captureCtx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
      const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.9);
      const base64 = dataUrl.split(',')[1];
      
      // Call recognize API
      const resp = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          image: base64, 
          model: hiAcc && hiAcc.checked ? 'cnn' : 'auto' 
        })
      });

      const data = await parseApiResponse(resp);
      
      if (!data.ok) {
        throw new Error(data.error || 'Gagal mengenali wajah');
      }
      
      if (data.matched) {
        // Store user data in sessionStorage and redirect
        sessionStorage.setItem('recognizedUser', JSON.stringify(data.user));
        sessionStorage.setItem('capturedImage', dataUrl);
        window.location.href = '/result';
      } else {
        setStatus('❌ ' + data.message);
        captureBtn.disabled = false;
        stopBtn.disabled = false;
      }
      
    } catch(err){
      console.error(err);
      setStatus('❌ ' + err.message);
      captureBtn.disabled = false;
      stopBtn.disabled = false;
    }
  }

  window.addEventListener('resize', resizeCanvases);
  startBtn.addEventListener('click', startCamera);
  captureBtn.addEventListener('click', captureAndRecognize);
  stopBtn.addEventListener('click', stopCamera);
})();