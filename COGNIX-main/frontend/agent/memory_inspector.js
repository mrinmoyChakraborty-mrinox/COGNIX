const API_BASE = 'http://localhost:8000';

(async function init() {
  showSkeleton(true);
  try {
    const customers = await fetchJSON('/customers');
    if (!customers.length) {
      showEmpty('No customers found. Create one to get started.');
      return;
    }
    const enriched = await Promise.all(
      customers.map(async (c) => {
        try {
          const [memories, tickets] = await Promise.all([
            fetchJSON(`/customers/${c.id}/memories`),
            fetchJSON(`/customers/${c.id}/tickets`),
          ]);
          return { ...c, memories, tickets };
        } catch {
          return { ...c, memories: [], tickets: [] };
        }
      })
    );
    renderTable(enriched);
  } catch (err) {
    console.error('Failed to load memory inspector:', err);
    showEmpty('Could not connect to the backend. Make sure the API server is running.');
  } finally {
    showSkeleton(false);
  }
})();

function renderTable(customers) {
  const tbody = document.getElementById('memory-table-body');
  if (!tbody) return;
  tbody.innerHTML = customers.map(c => {
    const factCount = c.memories.length;
    const lastActive = c.memories.length
      ? timeAgo(new Date(Math.max(...c.memories.map(m => new Date(m.created_at)))))
      : 'Never';
    const accPct = computeAccuracy(c.tickets);
    return `
      <div>
        <input type="checkbox" id="expand-${c.id}" class="expand-toggle" />
        <label for="expand-${c.id}" class="expand-label">
          <div class="grid px-4 py-3.5 border-b border-border items-center${factCount ? ' bg-secondary' : ''}" style="grid-template-columns: 2fr 80px 100px 120px 100px">
            <div class="flex items-center gap-3">
              <span class="expand-icon" style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 16px; height: 16px; color: var(--color-muted-foreground); margin-right: 4px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16px" height="16px" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m6 9l6 6l6-6"></path></svg>
              </span>
              <img src="https://storage.googleapis.com/banani-avatars/avatar/male/25-35/South Asian/${Math.floor(Math.random() * 5)}" class="w-8 h-8 rounded-full" />
              <span class="text-sm font-medium text-foreground">${escapeHtml(c.name)}</span>
            </div>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-md ${c.frustration_score > 60 ? 'bg-warning text-warning-foreground' : c.frustration_score > 30 ? 'bg-muted text-foreground' : 'bg-success text-success-foreground'}">${c.frustration_score}</span>
            <span class="text-sm text-foreground font-medium">${factCount} <span class="text-muted-foreground font-normal">facts</span></span>
            <span class="text-sm text-muted-foreground">${lastActive}</span>
            <div>
              <span class="${accPct >= 70 ? 'text-success' : 'text-warning'} flex items-center gap-1 text-xs">
                <span style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 13px; height: 13px;" data-icon="check-circle"><svg xmlns="http://www.w3.org/2000/svg" width="13px" height="13px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3.6923076923076925"><path d="M21.801 10A10 10 0 1 1 17 3.335"></path><path d="m9 11l3 3L22 4"></path></g></svg></span>
                ${accPct >= 70 ? 'Verified' : 'Needs review'}
              </span>
            </div>
          </div>
        </label>

        <div class="expand-content${factCount ? ' bg-secondary border-b border-border' : ''}">
          <div class="px-6 py-4">
            ${factCount ? renderFacts(c.memories) : '<p class="text-xs text-muted-foreground">No memories stored for this customer.</p>'}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderFacts(memories) {
  const groups = {
    'Environment': [],
    'Technical Stack': [],
    'Known Issues': [],
    'Resolutions': [],
    'Other': [],
  };
  memories.forEach(m => {
    const c = (m.content || '').toLowerCase();
    if (m.context === 'environment' || c.includes('os:') || c.includes('browser') || c.includes('macos') || c.includes('windows') || c.includes('linux')) {
      groups['Environment'].push(m);
    } else if (m.memory_type === 'experience' || c.includes('incident') || c.includes('error') || c.includes('timeout') || c.includes('outage') || c.includes('fail')) {
      groups['Known Issues'].push(m);
    } else if (m.memory_type === 'observation' || (c.includes('successful') && c.includes('resolution')) || c.includes('fix') || c.includes('resolved') || c.includes('patch')) {
      groups['Resolutions'].push(m);
    } else if (c.includes('api') || c.includes('sdk') || c.includes('version') || c.includes('runtime') || c.includes('node') || c.includes('python') || c.includes('framework')) {
      groups['Technical Stack'].push(m);
    } else {
      groups['Other'].push(m);
    }
  });

  return Object.entries(groups)
    .filter(([_, items]) => items.length)
    .map(([label, items]) => `
      <div class="${label !== 'Other' ? 'mb-4' : ''}">
        <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">${label}</span>
        <div class="grid grid-cols-2 gap-2">
          ${items.map(m => {
            const isIssue = label === 'Known Issues';
            const isRes = label === 'Resolutions';
            const borderColor = isIssue ? 'border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);' : isRes ? 'border-color: color-mix(in srgb, var(--color-success) 30%, transparent);' : '';
            return `
              <div class="flex items-center gap-3 bg-card rounded-md px-3 py-2 border border-border" style="${borderColor}">
                <span class="text-xs text-muted-foreground w-28 flex-shrink-0 truncate">${escapeHtml(m.context || m.memory_type)}</span>
                <span class="text-xs text-foreground font-medium flex-1 truncate">${escapeHtml(m.content)}</span>
                <div class="flex items-center gap-1.5 flex-shrink-0">
                  ${isIssue ? '<span class="text-warning"><span style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 11px; height: 11px;" data-icon="alert-circle"><svg xmlns="http://www.w3.org/2000/svg" width="11px" height="11px" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4.363636363636363"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4m0 4h.01"></path></g></svg></span></span>' : '<span class="text-success"><span style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 11px; height: 11px;" data-icon="check"><svg xmlns="http://www.w3.org/2000/svg" width="11px" height="11px" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4.363636363636363" d="M20 6L9 17l-5-5"></path></svg></span></span>'}
                  <button class="text-xs text-primary">Edit</button>
                  <button class="text-xs text-muted-foreground">Delete</button>
                  <button class="text-xs text-success">Verify</button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `).join('');
}

function computeAccuracy(tickets) {
  if (!tickets.length) return 0;
  const resolved = tickets.filter(t => t.status === 'resolved').length;
  return Math.round((resolved / tickets.length) * 100);
}

function showSkeleton(show) {
  document.querySelectorAll('.skeleton').forEach(el => {
    el.classList.toggle('hidden', !show);
  });
  document.querySelectorAll('.skeleton-target').forEach(el => {
    el.classList.toggle('hidden', show);
  });
}

function showEmpty(msg) {
  const tbody = document.getElementById('memory-table-body');
  if (tbody) {
    tbody.innerHTML = `<div class="px-4 py-8 text-center text-muted-foreground text-sm">${escapeHtml(msg)}</div>`;
  }
  showSkeleton(false);
}

function fetchJSON(path) {
  return fetch(`${API_BASE}${path}`).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${path}`);
    return r.json();
  });
}

function timeAgo(date) {
  const sec = Math.floor((Date.now() - date) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
