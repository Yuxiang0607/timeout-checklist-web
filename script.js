from fastapi import Request

@app.post("/transcribe-chunk", response_model=ChunkResp)
async def transcribe_chunk(audio: UploadFile = File(...), request: Request = None):
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="empty audio")

    # 調試用日誌：看來源、content_type、size、filename
    try:
        ip = request.client.host if request else "unknown"
    except Exception:
        ip = "unknown"
    print(f"[chunk] from {ip} ct={audio.content_type} size={len(content)} name={audio.filename}")

    # 依 content_type 猜一個副檔名，保證 f.name 有正確副檔名
    ct = (audio.content_type or "").lower()
    if audio.filename and "." in audio.filename:
        fname = audio.filename
    elif "mp4" in ct:
        fname = "chunk.mp4"
    elif "webm" in ct:
        fname = "chunk.webm"
    elif "wav" in ct:
        fname = "chunk.wav"
    elif "ogg" in ct:
        fname = "chunk.ogg"
    else:
        fname = "chunk.webm"  # 預設

    # 1) STT
    try:
        with io.BytesIO(content) as f:
            f.name = fname
            r = client.audio.transcriptions.create(
                model=STT_MODEL,
                file=f,
                temperature=0,
                language="en",
                prompt=DOMAIN_PROMPT
            )
    except Exception as e:
        # 把 OpenAI 的 400 改回 400 回前端（不要 500）
        msg = getattr(e, "message", str(e))
        print(f"[stt-error] {msg}")
        raise HTTPException(status_code=400, detail=f"OpenAI STT error: {msg}")

    rough = (r.text or "").strip()
    if not rough:
        return {"hits": [], "raw": [], "suggestions": []}

    # 2) 斷句
    sents = _segment_sentences(rough)
    if not sents:
        return {"hits": [], "raw": [], "suggestions": []}

    # 3) Embeddings 對映
    _ensure_canon_embeds()
    q_embs = _embed_texts(sents)
    hits, suggestions = [], []
    for s, q in zip(sents, q_embs):
        best_idx, best_score = -1, -1.0
        for i, c in enumerate(_canon_embeds):
            sim = _cos(q, c)
            if sim > best_score:
                best_idx, best_score = i, sim
        if best_score >= CANONICAL_THRESHOLD:
            hits.append(CANONICAL_SENTENCES[best_idx])
        else:
            suggestions.append({"raw": s, "best": CANONICAL_SENTENCES[best_idx], "score": round(best_score, 2)})

    return {"hits": hits, "raw": sents, "suggestions": suggestions}
