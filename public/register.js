(function(){
  const video = document.getElementById('regVideo');
  const nameInput = document.getElementById('nameInput');
  const startBtn = document.getElementById('startRegBtn');
  const registerBtn = document.getElementById('registerBtn');
  const statusEl = document.getElementById('regStatus');
  const hiAccReg = document.getElementById('hiAccReg');
  const snapshot = document.getElementById('snapshot');
  const snapCtx = snapshot.getContext('2d');

  let stream = null;

  function setStatus(msg){ statusEl.textContent = msg; }

  async function startCamera(){
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      await new Promise(res => video.onloadedmetadata = res);
      snapshot.width = video.videoWidth || 640;
      snapshot.height = video.videoHeight || 480;
      startBtn.disabled = true;
      registerBtn.disabled = false;
      setStatus('Kamera aktif. Pastikan hanya satu wajah terlihat.');
    } catch(err){
      console.error(err);
      setStatus('Gagal mengakses kamera: ' + err.message);
    }
  }

  async function registerOnce(){
    const name = (nameInput.value || '').trim();
    if (!name){ setStatus('Nama wajib diisi.'); return; }
    if (!stream){ setStatus('Kamera belum aktif.'); return; }
    snapCtx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    const dataUrl = snapshot.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1];
    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: base64, model: hiAccReg && hiAccReg.checked ? 'cnn' : 'auto' })
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Gagal mendaftar');
      setStatus('Berhasil mendaftarkan: ' + name);
    } catch(err){
      console.error(err);
      setStatus('Gagal mendaftar: ' + err.message);
    }
  }

  startBtn.addEventListener('click', startCamera);
  registerBtn.addEventListener('click', registerOnce);
})();
