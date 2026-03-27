(function(){
  const video = document.getElementById('regVideo');
  const nameInput = document.getElementById('nameInput');
  const nimInput = document.getElementById('nimInput');
  const genderInput = document.getElementById('genderInput');
  const ageInput = document.getElementById('ageInput');
  const startBtn = document.getElementById('startRegBtn');
  const registerBtn = document.getElementById('registerBtn');
  const statusEl = document.getElementById('regStatus');
  const hiAccReg = document.getElementById('hiAccReg');
  const snapshot = document.getElementById('snapshot');
  const snapCtx = snapshot.getContext('2d');

  let stream = null;

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
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
      await new Promise(res => video.onloadedmetadata = res);
      snapshot.width = video.videoWidth || 640;
      snapshot.height = video.videoHeight || 480;
      startBtn.disabled = true;
      registerBtn.disabled = false;
      setStatus('📹 Kamera aktif. Pastikan hanya satu wajah terlihat, lalu klik Ambil & Daftar.');
    } catch(err){
      console.error(err);
      setStatus('❌ Gagal mengakses kamera: ' + err.message);
    }
  }

  async function registerOnce(){
    const name = (nameInput.value || '').trim();
    const nim = (nimInput.value || '').trim();
    const gender = (genderInput.value || '').trim();
    const age = parseInt(ageInput.value);
    
    // Validation
    if (!name){ 
      setStatus('❌ Nama wajib diisi.'); 
      return; 
    }
    if (!nim){ 
      setStatus('❌ NIM wajib diisi.'); 
      return; 
    }
    if (!gender){ 
      setStatus('❌ Jenis kelamin wajib dipilih.'); 
      return; 
    }
    if (!age || age < 1 || age > 150){ 
      setStatus('❌ Usia tidak valid (1-150 tahun).'); 
      return; 
    }
    if (!stream){ 
      setStatus('❌ Kamera belum aktif.'); 
      return; 
    }
    
    // Disable button to prevent double submission
    registerBtn.disabled = true;
    setStatus('⏳ Memproses pendaftaran...');
    
    snapCtx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    const dataUrl = snapshot.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1];
    
    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name, 
          nim,
          gender,
          age,
          image: base64, 
          model: hiAccReg && hiAccReg.checked ? 'cnn' : 'auto' 
        })
      });
      const data = await parseApiResponse(resp);
      
      if (!data.ok) throw new Error(data.error || 'Gagal mendaftar');
      
      setStatus('✅ ' + data.message);
      
      // Clear form
      nameInput.value = '';
      nimInput.value = '';
      genderInput.value = '';
      ageInput.value = '';
      
      // Show success and redirect after 2 seconds
      setTimeout(() => {
        window.location.href = '/users';
      }, 2000);
      
    } catch(err){
      console.error(err);
      setStatus('❌ ' + err.message);
      registerBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', startCamera);
  registerBtn.addEventListener('click', registerOnce);
})();