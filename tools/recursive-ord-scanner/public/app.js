(() => {
  const form = document.getElementById('form');
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');
  const startBtn = document.getElementById('startBtn');
  let es;

  async function startCapture() {
    try {
      if (es) { try { es.close(); } catch {} es = null; }
      logEl.textContent = '';
      statusEl.textContent = 'Starting...';

      const fd = new FormData(form);
      const body = Object.fromEntries(fd.entries());
      const resp = await fetch('/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.jobId) {
        statusEl.textContent = 'Error: ' + (data.error || 'unknown');
        return;
      }
      const jobId = data.jobId;
      statusEl.textContent = 'Job ' + jobId + ' started';

      es = new EventSource('/events/' + jobId);
      es.onmessage = (ev) => {
        let s = null;
        try { s = JSON.parse(ev.data); } catch {}
        if (!s) { statusEl.textContent = 'Waiting for job updates...'; return; }
        statusEl.textContent = 'Status: ' + s.status + ' | ' + s.progress + '/' + s.total + (s.finishedAt ? ' | done' : '');
        logEl.textContent = (s.log || []).join('\n');
        logEl.scrollTop = logEl.scrollHeight;
        if (s.status === 'completed' || s.status === 'failed') {
          try { es.close(); } catch {}
          es = null;
        }
      };
      es.onerror = () => { /* ignore */ };
    } catch (err) {
      statusEl.textContent = 'Error: ' + (err?.message || err);
    }
  }

  // Prevent accidental submit/reload just in case
  form.addEventListener('submit', (e) => e.preventDefault());
  startBtn.addEventListener('click', (e) => {
    e.preventDefault();
    startCapture();
  });
})();
