/* ============================================
   FoxiMed — Voice Logger (Hardened)
   ============================================ */
(function (window) {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────
  const WORKER_URL = 'https://foximed-voice-worker.mohammad-mahdi-ta.workers.dev/voice-log';
  const CORRECTION_URL = 'https://foximed-voice-worker.mohammad-mahdi-ta.workers.dev/correction';
  const BATCH_SIZE = 20;
  const FLUSH_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours
  const MAX_RETRY_DELAY = 60000;
  const STORAGE_KEY = 'voiceLogs';
  const RETRY_KEY = 'voiceLogRetryQueue';

  // ─── State ──────────────────────────────────────────────────
  let isUploading = false;
  let flushTimer = null;
  let retryTimer = null;
  let retryDelay = 2000;

  // ─── Settings ──────────────────────────────────────────────
  function isOptedIn() {
    return window.AppState && window.AppState.settings && window.AppState.settings.voiceLogging === true;
  }

  // ─── UUID Generator ──────────────────────────────────────────
  function generateUUID() {
    // Simple UUID v4 (RFC4122) – works in all browsers
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ─── Local Storage Helpers ─────────────────────────────────
  function getLogs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function setLogs(logs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      // quota exceeded – drop oldest logs
      if (logs.length > 100) {
        logs = logs.slice(-100);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
      }
    }
  }

  function getRetryQueue() {
    try {
      return JSON.parse(localStorage.getItem(RETRY_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function setRetryQueue(queue) {
    try {
      localStorage.setItem(RETRY_KEY, JSON.stringify(queue));
    } catch (e) { /* ignore */ }
  }

  // ─── Log Queue ──────────────────────────────────────────────
  function addLog(entry) {
    if (!isOptedIn()) return;
    if (!entry.transcript) return;

    const logEntry = {
      client_generated_id: generateUUID(),
      transcript: entry.transcript,
      normalized: entry.normalized || null,
      winner: entry.winner || null,
      scores: entry.scores || null,
      entities: entry.entities || null,   // e.g., { weight: 70, height: 168 }
      success: entry.success !== undefined ? entry.success : null,
      version: entry.version || '4.8.2',
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    const logs = getLogs();
    logs.push(logEntry);
    setLogs(logs);

    if (logs.length >= BATCH_SIZE) {
      scheduleFlush(0);
    } else {
      scheduleFlush();
    }
  }

  // ─── Upload ──────────────────────────────────────────────────
  async function flush() {
    if (isUploading) return;
    if (!isOptedIn()) {
      setLogs([]);
      return;
    }

    await processRetryQueue();

    const logs = getLogs();
    if (logs.length === 0) return;

    isUploading = true;
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logs),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      if (result.success) {
        const inserted = result.inserted || logs.length;
        const remaining = logs.slice(inserted);
        setLogs(remaining);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err) {
      // Move to retry queue
      const retryQueue = getRetryQueue();
      const combined = retryQueue.concat(logs);
      setRetryQueue(combined);
      setLogs([]);
      scheduleRetry();
    } finally {
      isUploading = false;
    }
  }

  // ─── Retry Queue ─────────────────────────────────────────────
  async function processRetryQueue() {
    const queue = getRetryQueue();
    if (queue.length === 0) return;

    let successCount = 0;
    const batch = queue.slice(0, BATCH_SIZE);
    try {
      const response = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          successCount = result.inserted || batch.length;
        }
      }
    } catch (e) {
      // failed – keep whole batch
    }

    if (successCount > 0) {
      const remaining = queue.slice(successCount);
      setRetryQueue(remaining);
    }
    // if no success, keep queue and retry later
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      processRetryQueue();
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
      // Add small jitter to avoid thundering herd
      const jitter = Math.random() * 0.5 + 0.75;
      if (getRetryQueue().length > 0) {
        retryDelay = Math.min(retryDelay * jitter, MAX_RETRY_DELAY);
        scheduleRetry();
      } else {
        retryDelay = 2000;
      }
    }, retryDelay);
  }

  // ─── Schedule Flush ──────────────────────────────────────────
  function scheduleFlush(delay) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const ms = delay !== undefined ? delay : FLUSH_INTERVAL;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, ms);
  }

  // ─── Online/Offline ─────────────────────────────────────────
  function handleOnline() {
    // try to send pending logs immediately
    flush();
  }

  function handleOffline() {
    // no action – logs remain in storage
  }

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  // ─── Correction Submission ───────────────────────────────────
  function submitCorrection(logId, correctedTranscript, correctedIntent, notes) {
    if (!isOptedIn()) return Promise.reject('Opt-out');
    return fetch(CORRECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logId, correctedTranscript, correctedIntent, notes }),
    }).then(res => res.json());
  }

  // ─── Public API ──────────────────────────────────────────────
  const VoiceLogger = {
    log: addLog,
    flush: flush,
    submitCorrection: submitCorrection,
    isOptedIn: isOptedIn,
    setOptIn: function (enabled) {
      if (!enabled) {
        setLogs([]);
        setRetryQueue([]);
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        retryDelay = 2000;
      } else {
        flush();
        scheduleFlush();
      }
    },
    getQueuedCount: function () {
      return getLogs().length + getRetryQueue().length;
    },
  };

  window.VoiceLogger = VoiceLogger;

  // ─── Auto‑flush on load ──────────────────────────────────────
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    if (isOptedIn()) {
      setTimeout(flush, 1000);
      scheduleFlush();
    }
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (isOptedIn()) {
        setTimeout(flush, 1000);
        scheduleFlush();
      }
    });
  }

})(window);
