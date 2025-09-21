// ======== 後端位置 ========
const API_BASE = "https://timeout-checklist-server.onrender.com";

// ======== 你的清單（跟後端一致）========
const checklist = [
  { title: "Timeout Initiation", items: [
    "Is everyone ready to begin the timeout?",
    "Do we have the consent form in front of us?"
  ]},
  { title: "Team Introduction", items: [
    "Please introduce yourselves.",
    "Is the attending physician present?",
    "Who is the anesthesia attending?",
    "What are the names and roles of the other team members?"
  ]},
  { title: "Patient Identification", items: [
    "What is your full name?",
    "What is your date of birth?",
    "What is your Medical Record Number?"
  ]},
  { title: "Surgical Consent Verification", items: [
    "Is the consent form signed?",
    "What surgery and/or block is being performed?",
    "Which side?",
    "Is it marked?"
  ]},
  { title: "Local Anesthetic Plan", items: [
    "Which local anesthetic will be used?",
    "What is the intended concentration?",
    "What is the intended volume?"
  ]},
  { title: "Patient Medical Considerations", items: [
    "Are you currently taking any anticoagulants?",
    "Do you have any clotting disorders?",
    "Do you have any known drug allergies?",
    "Do you have a history of systemic neuropathy and/or neuropathy at the surgical site?"
  ]},
  { title: "Monitoring System Check", items: [
    "Is NIBP monitoring ready?",
    "Is ECG monitoring ready?",
    "Is SpO₂ ready?",
    "Is EtCO₂ monitoring ready?"
  ]},
  { title: "Additional Concerns", items: [
    "Does anyone have any other question or concern?"
  ]},
  { title: "Timeout Completion", items: [
    "Timeout completed."
  ]}
];

// ======== 渲染 UI ========
const checklistDiv = document.getElementById('checklist');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const exportLink = document.getElementById('exportLink');

const allSentences = checklist.flatMap(g => g.items);
const sentenceToIndex = new Map(allSentences.map((s, i) => [s, i]));

const itemRows = [];
checklist.forEach(group => {
  const groupDiv = document.createElement('div');
  groupDiv.className = 'group';
  const titleDiv = document.createElement('div');
  titleDiv.className = 'group-title';
  titleDiv.textContent = group.title;
  groupDiv.appendChild(titleDiv);
  const ul = document.createElement('div');
  ul.className = 'item-list';
  group.items.forEach(text => {
    const row = document.createElement('div');
    row.className = 'item-row';
    const span = document.createElement('span');
    span.className = 'item-text';
    span.textContent = text;
    const dot = document.createElement('span');
    dot.className = 'red-dot';
    row.appendChild(span);
    row.appendChild(dot);
    ul.appendChild(row);
    itemRows.push(row);
  });
  groupDiv.appendChild(ul);
  checklistDiv.appendChild(groupDiv);
});

function setGreen(sentence){
  const idx = sentenceToIndex.get(sentence);
  if (idx == null) return;
  const dot = itemRows[idx].querySelector('.red-dot');
  dot.classList.add('green-dot');
}

// ======== Session & 錄音 ========
let sessionId = null;
let mediaRecorder = null;
let listening = false;

async function newSession(){
  const res = await fetch(`${API_BASE}/start`, { method: "POST" });
  const data = await res.json();
  sessionId = data.session_id;
  exportLink.href = `${API_BASE}/export/${sessionId}`;
  exportLink.style.display = "none";
}

async function startRecording(){
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

  mediaRecorder.ondataavailable = async (e) => {
    if (!e.data || e.data.size === 0 || !listening) return;
    const fd = new FormData();
    fd.append("session_id", sessionId);
    fd.append("audio", e.data, "chunk.webm");
    try{
      const res = await fetch(`${API_BASE}/chunk`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.error){ console.error("Server error:", data.error); return; }
      (data.hits || []).forEach(h => setGreen(h.sentence));
      if (data.terminate){
        stopFlow();
      }
    }catch(err){
      console.error(err);
    }
  };

  // 每 2500ms 自動觸發一個 dataavailable（→ 2.5 秒一塊）
  mediaRecorder.start(2250);
}

function stopFlow(){
  listening = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive"){
    mediaRecorder.stop();
  }
  startBtn.disabled = false;
  stopBtn.style.display = "none";
  startBtn.textContent = "🎤 Start Recognition";
  exportLink.style.display = "inline-block"; // 可下載純文字結果
}

startBtn.onclick = async ()=>{
  // 重置 UI
  itemRows.forEach(r => r.querySelector('.red-dot').classList.remove('green-dot'));
  exportLink.style.display = "none";

  startBtn.disabled = true;
  stopBtn.style.display = "";
  startBtn.textContent = "🎙️ Recognizing...";
  await newSession();
  listening = true;
  await startRecording();
};

stopBtn.onclick = ()=>{
  const fd = new FormData();
  fd.append("session_id", sessionId);
  fetch(`${API_BASE}/reset`, { method: "POST", body: fd }).catch(()=>{});
  stopFlow();
};
