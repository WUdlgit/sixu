export type StartupPhase = 'settings' | 'database' | 'history' | 'notes' | 'ready'
export type StartupEvent = 'started' | 'completed' | 'failed'

declare global {
  interface Window {
    __sixuStartup?: {
      mark: (phase: string, event: string, category?: string) => void
    }
  }
}

// Never persist exception messages, configuration values, document text or URLs.
export function startupErrorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/permission|access.*denied|not allowed|forbidden|os error 5/i.test(message)) return 'access-denied'
  if (/chunk|loading.*module|import.*failed/i.test(message)) return 'resource-load'
  if (/database.*locked|sqlite_busy/i.test(message)) return 'database-busy'
  if (/sqlite|database|sqlx/i.test(message)) return 'database'
  if (/invoke|ipc|tauri|bridge/i.test(message)) return 'native-bridge'
  return 'unknown'
}

export function recordStartupEvent(phase: StartupPhase, event: StartupEvent, error?: unknown) {
  if (typeof window === 'undefined') return
  window.__sixuStartup?.mark(phase, event, error === undefined ? undefined : startupErrorCategory(error))
}

// Inline in the exported HTML: this must work even when React/Next chunks fail.
// No external script, native bridge, model service or application store required.
export const STARTUP_BOOTSTRAP = String.raw`(function () {
  if (location.pathname !== '/' && location.pathname.indexOf('/core/') !== 0) return;
  if (window.__sixuStartup) return;
  var key = 'sixu-startup-diagnostics-v1';
  var ready = false, phase = 'bootstrap', timer;
  var entries = [];
  try {
    var previous = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(previous)) entries = previous.slice(-30).filter(function (item) {
      return item && typeof item.at === 'number' && typeof item.phase === 'string' && typeof item.event === 'string';
    }).map(function (item) {
      return { at: item.at, phase: item.phase.slice(0, 24), event: item.event.slice(0, 24), category: typeof item.category === 'string' ? item.category.slice(0, 24) : undefined };
    });
  } catch (_) {}
  function mark(nextPhase, event, category) {
    phase = nextPhase;
    entries.push({ at: Date.now(), phase: nextPhase, event: event, category: category });
    entries = entries.slice(-40);
    try { localStorage.setItem(key, JSON.stringify(entries)); } catch (_) {}
    if (event === 'started' && nextPhase !== 'bootstrap') {
      clearTimeout(timer);
      timer = setTimeout(checkTimeout, 20000);
    }
    if (nextPhase === 'ready' && event === 'completed') {
      ready = true;
      clearTimeout(timer);
      var panel = document.getElementById('sixu-startup-fallback');
      if (panel) panel.remove();
    }
  }
  function showFailure() {
    if (ready || document.getElementById('sixu-startup-fallback')) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', showFailure, { once: true }); return; }
    var panel = document.createElement('section');
    panel.id = 'sixu-startup-fallback';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:36px 0 0;z-index:2147483647;background:#111;color:#eee;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:32px;font:16px system-ui;text-align:center';
    var heading = document.createElement('h1');
    heading.textContent = '启动未完成，本地数据尚未加载';
    var description = document.createElement('p');
    description.textContent = '当前无法确认笔记、历史和模型配置。请重新加载；持续失败时请保留启动诊断。';
    var retry = document.createElement('button');
    retry.textContent = '重新加载';
    retry.style.cssText = 'padding:10px 24px;color:#111;background:#eee;border:0;border-radius:8px;cursor:pointer';
    retry.onclick = function () { location.reload(); };
    var details = document.createElement('details');
    var summary = document.createElement('summary');
    summary.textContent = '启动诊断（不含笔记、对话和密钥）';
    var report = document.createElement('pre');
    report.style.cssText = 'max-height:240px;overflow:auto;text-align:left;font-size:12px';
    report.textContent = JSON.stringify(entries, null, 2);
    details.appendChild(summary); details.appendChild(report);
    panel.appendChild(heading); panel.appendChild(description); panel.appendChild(retry); panel.appendChild(details);
    document.body.appendChild(panel);
  }
  window.__sixuStartup = { mark: mark };
  mark('bootstrap', 'started');
  window.addEventListener('error', function (event) {
    if (ready) return;
    var target = event.target;
    if (target && target.tagName === 'SCRIPT') {
      mark(phase, 'failed', 'script-load'); showFailure();
    } else if (event.error) {
      mark(phase, 'failed', 'javascript');
    }
  }, true);
  window.addEventListener('unhandledrejection', function () {
    if (!ready) mark(phase, 'failed', 'unhandled-promise');
  });
  function checkTimeout() {
    // Waiting for the user to unlock is intentional, not a startup failure.
    if (document.querySelector('[data-sixu-startup-paused]')) return;
    if (!ready) { mark(phase, 'timeout'); showFailure(); }
  }
  timer = setTimeout(checkTimeout, 20000);
})();`
