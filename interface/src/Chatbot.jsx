import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE, MAX_UPLOAD_BYTES, RISK_COLORS, RISK_LABELS, TOOL_LABELS, streamChat, uploadImage } from './lib/agentApi.js';
import { vehicleStore } from './store/vehicleStore.js';

const VERDICT_LABELS = { uyumlu: 'Uyumlu', celiskili: 'Çelişkili', ilgisiz: 'İlgisiz', dogrulanamaz: 'Doğrulanamaz' };
const UPLOAD_QUESTION = 'Yüklediğim görüntüyü analiz et: araçları tespit et, tiplerini ve görsel özelliklerini (renk, yük) açıkla. Dikkat gerektiren bir şey var mı?';
const UPLOAD_SUGGESTIONS = [
  'Bu görüntüde kaç araç var, tipleri neler?',
  'Araçların renkleri ve yükleri neler?',
  UPLOAD_QUESTION,
];

function suggestionsFor(imageId) {
  if (!imageId) return [];
  return [
    `${imageId} riskli mi?`,
    `${imageId} görüntüsündeki araçlar ne yapıyor?`,
    `${imageId} için saha raporları tespitle tutarlı mı?`,
  ];
}

function PaperclipIcon() {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="m20 11.5-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></svg>;
}

function Attachment({ attachment, onRemove }) {
  return (
    <div className={`chat-attachment ${attachment.status}`}>
      <img src={attachment.previewUrl} alt="" />
      <div><strong>{attachment.name}</strong>
        <span>{attachment.status === 'uploading' ? 'Yükleniyor…' : attachment.status === 'error' ? attachment.error : `${attachment.image_id} · ${attachment.width_px}×${attachment.height_px} px`}</span></div>
      <button type="button" onClick={onRemove} aria-label="Görüntüyü kaldır" title="Görüntüyü kaldır">×</button>
    </div>
  );
}

function RiskBadge({ level }) {
  return <span className="risk-badge" style={{ '--risk': RISK_COLORS[level] ?? RISK_COLORS.BELIRSIZ }}>RİSK · {RISK_LABELS[level] ?? level}</span>;
}

function Steps({ steps, running }) {
  if (!steps.length && !running) return null;
  return (
    <ol className="agent-steps" aria-label="Agent adımları">
      {steps.map((step) => (
        <li key={step.key} className={step.status}>
          <span className="step-mark" aria-hidden="true">{step.status === 'ok' ? '✓' : step.status === 'running' ? '…' : '!'}</span>
          {step.label}
          {step.detail && <em>{step.detail}</em>}
        </li>
      ))}
      {running && <li className="running"><span className="step-mark" aria-hidden="true">…</span>Agent düşünüyor</li>}
    </ol>
  );
}

function ReportList({ title, reports }) {
  if (!reports?.length) return null;
  return (
    <details className="brief-reports">
      <summary>{title} ({reports.length})</summary>
      <ul>{reports.map((report) => (
        <li key={`${title}-${report.report_id}`}><strong>{report.report_id}</strong> · {report.time} · {VERDICT_LABELS[report.verdict] ?? report.verdict}<p>{report.reason}</p></li>
      ))}</ul>
    </details>
  );
}

function Brief({ brief }) {
  return (
    <div className="agent-brief">
      <div className="brief-top"><RiskBadge level={brief.risk_level} />{brief.image_id && <span className="brief-image">{brief.image_id}</span>}</div>
      <p>{brief.summary}</p>
      {brief.risk_override_reason && <p className="brief-override">Kural seviyesinden sapma: {brief.risk_override_reason}</p>}
      {brief.vehicles_of_concern?.length > 0 && (
        <ul className="brief-vehicles">{brief.vehicles_of_concern.map((vehicle) => (
          <li key={vehicle.det_id} style={{ '--risk': RISK_COLORS[vehicle.risk_level] }}>
            <strong>{vehicle.det_id}{vehicle.track_id ? ` · ${vehicle.track_id}` : ''}</strong>
            <span>{RISK_LABELS[vehicle.risk_level] ?? vehicle.risk_level}</span>
            <p>{vehicle.reason}</p>
          </li>
        ))}</ul>
      )}
      <ReportList title="Kullanılan raporlar" reports={brief.used_reports} />
      <ReportList title="Reddedilen raporlar" reports={brief.rejected_reports} />
      {brief.evidence?.length > 0 && (
        <details className="brief-reports"><summary>Dayanaklar ({brief.evidence.length})</summary>
          <ul>{brief.evidence.map((item, index) => <li key={`${item.ref_id}-${index}`}><strong>{item.ref_id}</strong> · {TOOL_LABELS[item.source_tool] ?? item.source_tool}<p>{item.fact}</p></li>)}</ul>
        </details>
      )}
    </div>
  );
}

function useBackendStatus() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE}/api/health`, { signal: controller.signal })
      .then((response) => response.json()).then(setStatus)
      .catch((error) => { if (error.name !== 'AbortError') setStatus({ status: 'offline' }); });
    return () => controller.abort();
  }, []);
  return status;
}

const WELCOME_TEXT = [
  'ATMACA arayüzü hazır. Üç şekilde başlayabilirsiniz:',
  '• Haritadan bir araç seçin ve "Agent ile analiz et" deyin.',
  '• Doğrudan sorun (ör. "img_003839 riskli mi?").',
  '• Ataç düğmesiyle bir drone görüntüsü yükleyin (sürükle-bırak ya da yapıştır da olur); araçları tespit edip görsel olarak incelerim. Yüklenen görüntünün konum ve saat bilgisi olmadığı için hareket kaydı ve saha raporu analizi yapılmaz.',
].join('\n');

const welcomeMessage = () => ({ id: crypto.randomUUID(), role: 'assistant', text: WELCOME_TEXT, steps: [] });

export default function Chatbot({ selectedVehicle, selectedImage, request, onBrief, simTime }) {
  const [messages, setMessages] = useState(() => [welcomeMessage()]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const sessionId = useRef(null);
  const controller = useRef(null);
  const end = useRef(null);
  const handled = useRef(null);
  const fileInput = useRef(null);
  const uploadController = useRef(null);
  const [attachment, setAttachment] = useState(null);
  const [dragging, setDragging] = useState(false);
  const backend = useBackendStatus();

  useEffect(() => () => { controller.current?.abort(); uploadController.current?.abort(); }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, pending]);

  const update = useCallback((id, change) => setMessages((previous) => previous.map((message) => (message.id === id ? change(message) : message))), []);

  const send = useCallback(async (text, imageId, image = null) => {
    const value = text.trim();
    if (!value || controller.current || value.length > 1200) return;
    const answerId = crypto.randomUUID();
    setMessages((previous) => [...previous,
      { id: crypto.randomUUID(), role: 'user', text: value, image },
      { id: answerId, role: 'assistant', text: '', steps: [], running: true }]);
    setInput('');
    setPending(true);
    const own = new AbortController();
    controller.current = own;

    const onEvent = ({ event, data }) => {
      if (event === 'session') sessionId.current = data.session_id;
      else if (event === 'tool_call') {
        update(answerId, (message) => ({ ...message, steps: [...message.steps, { key: `${data.turn}-${message.steps.length}`, tool: data.tool, label: TOOL_LABELS[data.tool] ?? data.tool, status: 'running' }] }));
      } else if (event === 'tool_result') {
        if (data.tool === 'show_vehicle' && data.status === 'ok') vehicleStore.getState().requestPick(data.result?.vehicle_id);
        update(answerId, (message) => {
          const index = message.steps.findIndex((step) => step.tool === data.tool && step.status === 'running');
          if (index < 0) return message;
          const steps = [...message.steps];
          steps[index] = { ...steps[index], status: data.status === 'ok' ? 'ok' : 'error', detail: data.status === 'ok' ? '' : (data.result?.detail ?? data.status) };
          return { ...message, steps };
        });
      } else if (event === 'brief_rejected') {
        update(answerId, (message) => ({ ...message, steps: [...message.steps, { key: `rejected-${message.steps.length}`, label: 'Brief doğrulamadan geçmedi, düzeltiliyor', status: 'error' }] }));
      } else if (event === 'brief') {
        update(answerId, (message) => ({ ...message, brief: data.brief }));
        if (data.brief.image_id) onBrief?.(data.brief.image_id, data.brief);
      } else if (event === 'error') {
        update(answerId, (message) => ({ ...message, error: data.detail }));
      } else if (event === 'done') {
        update(answerId, (message) => ({ ...message, meta: `${data.turns} tur · ${data.tokens_used.toLocaleString('tr-TR')} token` }));
      }
    };

    try {
      await streamChat({ message: value, sessionId: sessionId.current, imageId, simTime, onEvent, signal: own.signal });
    } catch (error) {
      if (error.name !== 'AbortError') update(answerId, (message) => ({ ...message, error: `Backend'e ulaşılamadı: ${error.message}` }));
    } finally {
      update(answerId, (message) => ({ ...message, running: false }));
      // Oturum sıfırlandıysa yeni bir istek başlamış olabilir; onun durumuna dokunma.
      if (controller.current === own) {
        controller.current = null;
        setPending(false);
      }
    }
  }, [onBrief, update, simTime]);

  const removeAttachment = useCallback(() => {
    uploadController.current?.abort();
    uploadController.current = null;
    setAttachment((previous) => {
      if (previous) URL.revokeObjectURL(previous.previewUrl);
      return null;
    });
  }, []);

  // Görüntü seçilir seçilmez yüklenir; gönderimde yalnızca `upl_…` kimliği gider.
  const attach = useCallback(async (file) => {
    if (!file) return;
    removeAttachment();
    const previewUrl = URL.createObjectURL(file);
    const base = { name: file.name || 'panodan-goruntu', previewUrl };
    if (!file.type.startsWith('image/')) {
      setAttachment({ ...base, status: 'error', error: 'Yalnızca görüntü dosyaları yüklenebilir.' });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setAttachment({ ...base, status: 'error', error: 'Dosya 20 MB sınırını aşıyor.' });
      return;
    }
    setAttachment({ ...base, status: 'uploading' });
    const own = new AbortController();
    uploadController.current = own;
    try {
      const info = await uploadImage(file, own.signal);
      if (uploadController.current === own) setAttachment({ ...base, ...info, name: base.name, status: 'ready' });
    } catch (error) {
      if (error.name !== 'AbortError' && uploadController.current === own) {
        setAttachment({ ...base, status: 'error', error: `Yüklenemedi: ${error.message}` });
      }
    } finally {
      if (uploadController.current === own) uploadController.current = null;
    }
  }, [removeAttachment]);

  const ready = attachment?.status === 'ready';
  const submit = useCallback((text) => {
    if (controller.current || attachment?.status === 'uploading') return;
    if (ready) {
      send(text.trim() || UPLOAD_QUESTION, attachment.image_id, { url: attachment.previewUrl, name: attachment.name });
      setAttachment(null); // Önizleme URL'si mesajda kullanılmaya devam eder.
    } else {
      send(text, selectedImage?.image_id ?? null);
    }
  }, [attachment, ready, send, selectedImage]);

  // Yeni oturum: yanıtı durdurur, geçmişi temizler; sonraki soru backend'de yeni agent oturumu açar.
  const resetSession = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    sessionId.current = null;
    setPending(false);
    setInput('');
    removeAttachment();
    setMessages([welcomeMessage()]);
  }, [removeAttachment]);

  // Görüntü panelinden gelen "Agent'a sor" istekleri.
  useEffect(() => {
    if (!request || handled.current === request.id) return;
    handled.current = request.id;
    send(request.text, request.imageId);
  }, [request, send]);

  const imageId = selectedImage?.image_id ?? null;
  const online = backend && backend.status === 'ok';

  return (
    <aside className="chat-panel" aria-label="Taktiksel asistan">
      <div className="chat-heading">
        <div className="flex items-center gap-3"><div className="assistant-symbol">✳</div><div><h2>Taktiksel Asistan</h2><p>ATMACA INTELLIGENCE INTERFACE</p></div></div>
        <div className="chat-heading-actions">
          <button className="chat-reset" onClick={resetSession} disabled={!pending && messages.length <= 1}
            title="Sohbeti temizle ve yeni agent oturumu başlat" aria-label="Sohbeti sıfırla ve yeni oturum başlat">
            <span aria-hidden="true">↻</span> YENİ OTURUM
          </button>
          <span className="demo-tag">{online ? 'AGENT' : backend ? 'ÇEVRİMDIŞI' : '…'}</span>
        </div>
      </div>
      <div className="context-card"><span className="eyebrow">AKTİF BAĞLAM</span><strong>{selectedVehicle ? `${selectedVehicle.id} / ${selectedVehicle.name}` : 'Genel saha görünümü'}</strong><span className="context-meta"><i className="status-dot" />{imageId ? `${imageId} · ${selectedImage.capture_time} · ${selectedImage.nearest_zone} · üsse ${(selectedImage.dist_to_base_m / 1000).toFixed(2)} km` : selectedVehicle ? 'Görüntüde tespit yok · yalnızca hareket kaydı' : `Sanal saat ${simTime} · haritadan bir araç seçin`}</span></div>
      <div className="chat-log" role="log" aria-live="polite" aria-label="Mesajlar">
        <div className="log-divider">OTURUM BAŞLANGICI</div>
        {messages.map((message) => (
          <article key={message.id} className={`message ${message.role}`}>
            <div className="message-author">{message.role === 'assistant' ? '✳  ATMACA' : 'OPERATÖR'}<span>{message.role === 'assistant' ? (message.meta ?? 'AGENT') : 'SİZ'}</span></div>
            {message.image && <img className="message-image" src={message.image.url} alt={`Yüklenen görüntü: ${message.image.name}`} />}
            {message.text && <p>{message.text}</p>}
            {message.role === 'assistant' && <Steps steps={message.steps ?? []} running={message.running && !message.brief} />}
            {message.brief && <Brief brief={message.brief} />}
            {message.error && <p className="agent-error">{message.error}</p>}
          </article>
        ))}
        <div ref={end} />
      </div>
      <div className={`chat-compose ${dragging ? 'dragging' : ''}`}
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
        onDrop={(event) => { event.preventDefault(); setDragging(false); attach(event.dataTransfer.files[0]); }}>
        <div className="suggestions">{(ready ? UPLOAD_SUGGESTIONS : suggestionsFor(imageId)).map((prompt) => <button key={prompt} disabled={pending} onClick={() => submit(prompt)}>{prompt}<span>↗</span></button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); submit(input); }}>
          {attachment && <Attachment attachment={attachment} onRemove={removeAttachment} />}
          <label className="sr-only" htmlFor="chat-input">Asistana mesaj</label>
          <textarea id="chat-input" placeholder={ready ? 'Görüntü hakkında bir soru yazın ya da doğrudan gönderin…' : 'Asistana bir soru sorun ya da görüntü yükleyin…'} value={input} rows={2} maxLength={1200} onChange={(event) => setInput(event.target.value)}
            onPaste={(event) => { const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/')); if (file) { event.preventDefault(); attach(file); } }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(input); }
            }} />
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(event) => { attach(event.target.files[0]); event.target.value = ''; }} />
          <div className="compose-bottom">
            <button type="button" className="compose-attach" onClick={() => fileInput.current?.click()} disabled={pending} aria-label="Görüntü yükle" title="Görüntü yükle (sürükle-bırak ve yapıştır da çalışır)"><PaperclipIcon /></button>
            <span>↵ Gönder <b>·</b> Shift + ↵ Yeni satır</span>
            <button type="submit" disabled={pending || attachment?.status === 'uploading' || (!input.trim() && !ready)} aria-label="Mesaj gönder">↑</button>
          </div>
        </form>
        <p className="chat-disclaimer"><span className={`status-dot ${online ? '' : 'neutral'}`} />
          {online ? `Agent bağlı · ${backend.llm_provider.toUpperCase()} · tespit: ${backend.detector === 'track_proxy' ? 'track uç noktaları' : 'YOLO ensemble'}` : backend ? `Backend'e ulaşılamıyor (${API_BASE})` : 'Backend kontrol ediliyor…'}
        </p>
      </div>
    </aside>
  );
}
