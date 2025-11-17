(function(){
  const video = document.getElementById('regVideo');
  const nameInput = document.getElementById('nameInput');
  const startBtn = document.getElementById('startRegBtn');
  const registerBtn = document.getElementById('registerBtn');
  const statusEl = document.getElementById('regStatus');
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
      setStatus('✅ Camera active. Make sure only one face is visible.');
    } catch(err){
      console.error(err);
      setStatus('✗ Camera access failed: ' + err.message);
    }
  }

  async function registerOnce(){
    const name = (nameInput.value || '').trim();
    if (!name){ setStatus('⚠️ Name is required.'); return; }
    if (!stream){ setStatus('⚠️ Camera not active.'); return; }
    
    setStatus('📸 Capturing...');
    registerBtn.disabled = true;
    
    snapCtx.drawImage(video, 0, 0, snapshot.width, snapshot.height);
    const dataUrl = snapshot.toDataURL('image/jpeg', 0.9);
    const base64 = dataUrl.split(',')[1];
    
    try {
      const resp = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, image: base64 })
      });
      const data = await resp.json();
      if (!data.ok) throw new Error(data.error || 'Registration failed');
      
      setStatus('✅ Success! ' + name + ' has been registered.');
      nameInput.value = '';
      
      // Redirect after 2 seconds
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch(err){
      console.error(err);
      setStatus('✗ Registration failed: ' + err.message);
      registerBtn.disabled = false;
    }
  }

  startBtn.addEventListener('click', startCamera);
  registerBtn.addEventListener('click', registerOnce);
})();
