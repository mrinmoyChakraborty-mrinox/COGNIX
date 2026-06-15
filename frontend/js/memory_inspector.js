const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE } = window.CONFIG;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || session.user.email !== ADMIN_EMAIL) {
    window.location.href = "./chat.html";
    return;
  }
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
          <div class="grid px-4 py-3.5 border-b border-border items-center${factCount ? ' bg-secondary' : ''}" style="grid-template-columns: 2fr 80px 100px 120px 100px 110px">
            <div class="flex items-center gap-3">
              <span class="expand-icon" style="display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 16px; height: 16px; color: var(--color-muted-foreground); margin-right: 4px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16px" height="16px" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="m6 9l6 6l6-6"></path></svg>
              </span>
              <img src="https://storage.googleapis.com/banani-avatars/avatar/male/25-35/South Asian/${Math.floor(Math.random() * 5)}" class="w-8 h-8 rounded-full memory-avatar" data-customer-id="${escapeHtml(c.id)}" style="cursor:pointer" />
              <span class="text-sm font-medium text-foreground memory-name" data-customer-id="${escapeHtml(c.id)}" style="cursor:pointer">${escapeHtml(c.name)}</span>
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
            <div>
              <button class="start-session-btn" data-customer-id="${escapeHtml(c.id)}" style="font-size:12px;padding:4px 10px;border-radius:6px;background:var(--color-primary);color:var(--color-primary-foreground);border:none;cursor:pointer;white-space:nowrap">Start session</button>
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

  // Wire profile navigation
  const navToProfile = (cid) => window.location.href = `./customer_profile.html?customer_id=${cid}`;
  tbody.querySelectorAll('.memory-avatar, .memory-name').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      navToProfile(el.dataset.customerId);
    });
  });

  // Wire Start Session buttons
  tbody.querySelectorAll('.start-session-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.location.href = `./liveagent.html?customer_id=${btn.dataset.customerId}`;
    });
  });

  // Wire memory card click to open modal
  tbody.querySelectorAll('.memory-card').forEach(card => {
    card.addEventListener('click', () => {
      const content = card.dataset.memoryContent;
      const category = card.dataset.memoryCategory;
      const type = card.dataset.memoryType;
      const ctx = card.dataset.memoryContext;
      const overlay = document.createElement('div');
      overlay.className = 'memory-modal-overlay';
      overlay.innerHTML = `
        <div class="memory-modal">
          <div class="memory-modal-header">
            <div>
              <span class="memory-category-badge ${category.toLowerCase()}">${category}</span>
              <span class="text-xs text-muted-foreground ml-2">${escapeHtml(type)}${ctx ? ' / ' + escapeHtml(ctx) : ''}</span>
            </div>
            <button class="memory-modal-close">&times;</button>
          </div>
          <div class="memory-modal-content">${escapeHtml(content)}</div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.querySelector('.memory-modal-close').addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    });
  });
}

function renderFacts(memories) {
  const items = memories.map(m => ({
    memory: m,
    summary: window.formatMemory(m),
    category: window.categorizeMemory(m),
    border: m.memory_type === 'experience' ? 'border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);' : m.memory_type === 'observation' ? 'border-color: color-mix(in srgb, var(--color-success) 30%, transparent);' : '',
  }));
  return `
    <div class="memory-grid">
      ${items.map(({ memory: m, summary, category, border }) => `
        <div class="memory-card" style="${border}" data-memory-content="${escapeHtml(m.content)}" data-memory-category="${category}" data-memory-type="${escapeHtml(m.memory_type)}" data-memory-context="${escapeHtml(m.context || '')}">
          <div class="memory-card-header">
            <span class="memory-category-badge ${category.toLowerCase()}">${category}</span>
            <span class="text-xs text-muted-foreground">${escapeHtml(m.memory_type)}</span>
          </div>
          <div class="memory-card-text">${escapeHtml(summary)}</div>
          <div class="memory-card-footer">
            <span>${escapeHtml(m.context || '')}</span>
          </div>
        </div>
      `).join('')}
    </div>
  `;
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

async function fetchJSON(path) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const headers = { "Accept": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return res.json();
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
