// ======== 後端位置 ========
const API_BASE = "https://timeout-checklist-server.onrender.com";

// ======== 狀態列（可在 index.html body 最後加一個 <div id="status"></div>）=======
const statusEl = document.getElementById('status') || (() => {
  const d = document.createElement('div'); d.id = 'status';
  d.style.maxWidth = '950px'; d.style.margin = '12px auto'; d.style.color = '#666';
  document.body.appendChild(d); return d;
})();

function setStatus(msg) { statusEl.textContent = msg; }

// ======== 你的清單（略）========
// ...（保留你原本的 checklist 產生與 setGreen() 等程式碼）

// ======== Session & 錄音 ========
let sessionId = null;
let mediaRecorder = null;
let listening = false;
let streamRef = null; // 記住 MediaStream，Stop 時關掉

async function newSession(){
  const res = await fetch(`${API_BASE}/start`, { method: "POST" });
  const data = await res.json();
  sessionId = data.session_id;
  exportLink.href = `${API_BASE}/export/${sessionId}`;
  exportLink.style.display = "none";
}

async function requestMicOnce() {
  // 有些瀏覽器需要在「點擊事件處理中」呼叫 getUserMedia 才會跳授權
  try {
    setStatus("Requesting microphone permission…");
    const constraints = {
      audio: {
        channelCount: 1,
        sampleRate: 48000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false
      }
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    setStatus("Microphone permission granted.");
    return stream;
  } catch (err) {
    console.error("getUserMedia error:", err);
    let reason = "";
    if (err.name === "NotAllowedError") {
      reason = "Permission blocked. Click the lock icon → Site settings → Allow Microphone, then reload.";
    } else if (err.name === "NotFoundError" || err.name === "OverconstrainedError") {
      reason = "No microphone found, or the selected device is unavailable.";
    } else if (err.name === "SecurityError") {
      reason = "This page must be served over HTTPS or http://localhost.";
    } else {
      reason = err.message || String(err);
    }
    setStatus("❌ Failed to access microphone: " + reason);
    throw err;
  }
}

async function startRecording(){
  if (!('MediaRecorder' in window)) {
    setStatus("❌ Your browser does not support MediaRecorder. Try Chrome or Edge.");
    alert("MediaRecorder not supported. Please use Chrome/Edge.");
    return;
  }
  try {
    // 這裡不再再次 getUserMedia，直接用前面 requestMicOnce() 拿到的 stream
    const stream = streamRef;
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0 || !listening) return;
      const fd = new FormData();
      fd.append("session_id", sessionId);
      fd.append("audio", e.data, "chunk.webm");
      try {
        const res = await fetch(`${API_BASE}/chunk`, { method: "POST", body: fd });
        const data = await res.json();
        if (data.error){ console.error("Server error:", data.error); setStatus("Server error: "+data.error); return; }
        (data.hits || []).forEach(h => setGreen(h.sentence));
        if (data.terminate){
          setStatus("Detected: Timeout completed. Stopping…");
          stopFlow();
        }
      } catch(err){
        console.error(err);
        setStatus("❌ Upload failed: " + err);
      }
    };

    // 每 2500ms 觸發一塊
    mediaRecorder.start(2500);
    setStatus("Recording… sending 2.5s chunks to server.");
  } catch (e) {
    console.error("startRecording error:", e);
    setStatus("❌ startRecording error: " + (e.message || e));
  }
}

function stopFlow(){
  listening = false;
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive"){
      mediaRecorder.stop();
    }
    if (streamRef) {
      streamRef.getTracks().forEach(t => t.stop());
      streamRef = null;
    }
  } catch {}
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  startBtn.textContent = "🎤 Start Recognition";
  exportLink.style.display = "inline-block";
  setStatus("Stopped. You can export the text or start again.");
}

startBtn.onclick = async ()=>{
  // 環境檢查
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("❌ This browser does not support getUserMedia.");
    alert("Your browser does not support audio recording.");
    return;
  }

  // 重置 UI
  itemRows.forEach(r => r.querySelector('.red-dot').classList.remove('green-dot'));
  exportLink.style.display = "none";
  startBtn.disabled = true;
  stopBtn.style.display = "";
  startBtn.textContent = "🎙️ Recognizing...";

  try {
    await newSession();
    // **在點擊事件中**請求麥克風，確保會跳授權
    streamRef = await requestMicOnce();
    listening = true;
    await startRecording();
  } catch (e) {
    // 若授權失敗，恢復按鈕
    startBtn.disabled = false;
    stopBtn.style.display = "none";
    startBtn.textContent = "🎤 Start Recognition";
  }
};

stopBtn.onclick = ()=>{
  const fd = new FormData();
  fd.append("session_id", sessionId || "");
  fetch(`${API_BASE}/reset`, { method: "POST", body: fd }).catch(()=>{});
  stopFlow();
};
