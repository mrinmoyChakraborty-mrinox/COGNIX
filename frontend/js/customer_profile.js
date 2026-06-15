const { ADMIN_EMAIL, SUPABASE_URL, SUPABASE_ANON_KEY, API_BASE } = window.CONFIG;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const CUSTOMER_ID = params.get('customer_id');

// Replace the init() IIFE:
(async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session || session.user.email !== ADMIN_EMAIL) {
    window.location.href = "./chat.html";
    return;
  }

  if (!CUSTOMER_ID) {
    // No customer_id — redirect to first customer
    try {
      const { data: { session: s } } = 
        await supabaseClient.auth.getSession();
      const headers = { "Accept": "application/json" };
      if (s?.access_token) 
        headers["Authorization"] = `Bearer ${s.access_token}`;
      const res = await fetch(`${API_BASE}/customers`, { headers });
      if (res.ok) {
        const customers = await res.json();
        if (customers && customers.length > 0) {
          window.location.href = 
            `./customer_profile.html?customer_id=${customers[0].id}`;
          return;
        }
      }
    } catch (_) {}
    showError('No customer selected. Go to the dashboard and click a customer.');
    return;
  }

  // Show skeletons while loading
  showSkeleton(true);

  try {
    const [customer, tickets, memories] = await Promise.all([
      fetchJSON(`/customers/${CUSTOMER_ID}`),
      fetchJSON(`/customers/${CUSTOMER_ID}/tickets`),
      fetchJSON(`/customers/${CUSTOMER_ID}/memories`),
    ]);

    // Hide skeletons before populating
    showSkeleton(false);

    populateHeader(customer);
    populateKPIs(customer, tickets);
    populateHealthScore(customer);
    populateTimeline(tickets);
    populateMemoryGraph(memories);
    populateBehavior(memories);
    populatePreferences(memories);
    populateFrustrations(memories);
    wireBackBtn();
    wireStartSession();

  } catch (err) {
    console.error('Failed to load customer profile:', err);
    showSkeleton(false);
    showError(
      'Could not load customer data. ' +
      (err.message || 'Check the API server is running.')
    );
  }
})();

async function fetchJSON(path) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const headers = { "Accept": "application/json" };
  if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} for ${path}`);
  }
  return res.json();
}

function populateHeader(c) {
  setText('customer-name', c.name);
  setText('customer-email', c.email);
  const created = new Date(c.created_at);
  const years = Math.floor((Date.now() - created) / 31536000000);
  setText('customer-tenure', `Customer for ${years > 0 ? `${years} year${years > 1 ? 's' : ''}` : 'less than a year'}`);
  setFrustrationRing(c.frustration_score || 0);
}

function setFrustrationRing(score) {
  const ring = document.getElementById('frustration-ring-value');
  if (ring) ring.textContent = score;
  const circle = document.querySelector('.frustration-ring circle:last-child');
  if (circle) {
    const r = 27;
    const circ = 2 * Math.PI * r;
    const offset = circ - (score / 100) * circ;
    circle.setAttribute('stroke-dasharray', `${circ - offset} ${offset}`);
  }
}

function populateKPIs(c, tickets) {
  const total = tickets.length;
  const resolved = tickets.filter(t => t.status === 'resolved').length;
  const rate = total ? Math.round((resolved / total) * 100) : 0;
  setText('kpi-tickets', total);
  setText('kpi-resolved-rate', `${rate}%`);
  setText('kpi-frustration', c.frustration_score || 0);
}

function populateHealthScore(c) {
  const score = Math.max(0, Math.min(100, 100 - (c.frustration_score || 0)));
  setText('health-score-value', score);
  const fill = document.getElementById('health-score-fill');
  if (fill) fill.style.width = `${score}%`;
  const badge = document.getElementById('health-badge');
  if (!badge) return;
  if (score >= 70) {
    badge.className = 'status-badge bg-success/10 text-success';
    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-success"></span> Healthy';
  } else if (score >= 40) {
    badge.className = 'status-badge bg-warning/10 text-warning';
    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-warning"></span> At Risk';
  } else {
    badge.className = 'status-badge bg-danger/10 text-danger';
    badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-danger"></span> Critical';
  }
}

function populateTimeline(tickets) {
  const container = document.getElementById('timeline-container');
  if (!container) return;
  if (!tickets.length) {
    container.innerHTML = '<div class="body-text text-muted-foreground">No tickets yet.</div>';
    return;
  }
  const sorted = [...tickets].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  container.innerHTML = sorted.map((t, i) => {
    const date = formatDate(t.created_at);
    const isLast = i === sorted.length - 1;
    const color = t.status === 'resolved' ? 'bg-success' : 'bg-danger';
    const label = t.status === 'resolved' ? 'resolved' : t.status;
    return `
      <div class="flex gap-4">
        <div class="flex flex-col items-center">
          <div class="timeline-dot ${color}"></div>
          ${isLast ? '' : '<div class="timeline-line" style="min-height: 32px"></div>'}
        </div>
        <div class="${isLast ? '' : 'pb-5'} flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1 flex-wrap">
            <span class="text-xs bg-input text-muted-foreground px-2 py-0.5 rounded-sm">${date}</span>
            <span class="text-xs px-2 py-0.5 rounded-sm ${t.status === 'resolved' ? 'bg-success text-success-foreground' : 'bg-danger text-danger-foreground'}">${label}</span>
          </div>
          <p class="body-text text-foreground font-medium">${escapeHtml(t.subject)}</p>
        </div>
      </div>
    `;
  }).join('');
}

function populateMemoryGraph(memories) {
  const container = document.getElementById('memory-graph-container');
  if (!container) return;
  const facts = memories.filter(m => m.memory_type === 'world_fact').slice(0, 3);
  if (!facts.length) {
    container.innerHTML = '<div class="body-text text-muted-foreground">No technical context stored.</div>';
    return;
  }
  container.innerHTML = facts.map(f => {
    const conf = computeConfidence(f);
    return `
      <div class="memory-chip">
        <div class="flex items-center justify-between mb-3">
          <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Technical Context</span>
          <div class="confidence-dots">${renderDots(conf)}</div>
        </div>
        <div class="flex items-center gap-4">
          <div class="confidence-ring">
            <div class="confidence-ring-inner">${conf}%</div>
          </div>
          <div>
            <span class="text-base font-semibold text-foreground">${escapeHtml(window.formatMemory(f))}</span>
            <div class="flex items-center gap-1.5 mt-0.5">
              <span class="w-1.5 h-1.5 rounded-full bg-success"></span>
              <span class="text-xs text-muted-foreground">${conf}% confidence</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function populateBehavior(memories) {
  const container = document.getElementById('behavior-container');
  if (!container) return;
  const obs = memories.filter(m => m.memory_type === 'observation').slice(0, 1);
  container.innerHTML = obs.length
    ? `<div class="insight-card" style="background: linear-gradient(135deg, #f0f2f5 0%, #f5f6f8 100%);">
        <span class="flex-shrink-0" style="font-size: 20px; line-height: 1;">⚡</span>
        <div class="flex-1 min-w-0">
          <span class="body-text font-medium text-foreground block">${escapeHtml(window.formatMemory(obs[0]))}</span>
          <div class="flex items-center gap-2 mt-0.5">
            <div class="confidence-dots">${renderDots(75)}</div>
            <span class="text-xs text-muted-foreground">75% confidence</span>
          </div>
        </div>
      </div>`
    : '<div class="body-text text-muted-foreground">No behavior observations recorded.</div>';
}

function populatePreferences(memories) {
  const container = document.getElementById('preferences-container');
  if (!container) return;
  const likes = memories.filter(m =>
    m.context === 'preference' || m.content.toLowerCase().includes('prefer')
  ).slice(0, 1);
  container.innerHTML = likes.length
    ? `<div class="insight-card" style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);">
        <span class="flex-shrink-0" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background-color: var(--color-success); color: white; font-size: 12px; font-weight: 700;">✓</span>
        <span class="body-text font-medium text-foreground">${escapeHtml(window.formatMemory(likes[0]))}</span>
      </div>`
    : '<div class="body-text text-muted-foreground">No preferences recorded.</div>';
}

function populateFrustrations(memories) {
  const container = document.getElementById('frustrations-container');
  if (!container) return;
  const risks = memories.filter(m =>
    m.memory_type === 'experience' ||
    m.context === 'incident' ||
    m.content.toLowerCase().includes('escalat') ||
    m.content.toLowerCase().includes('frustrat')
  ).slice(0, 1);
  container.innerHTML = risks.length
    ? `<div class="insight-card" style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-color: color-mix(in srgb, var(--color-warning) 30%, transparent);">
        <span class="flex-shrink-0" style="font-size: 18px; line-height: 1;">⚠</span>
        <div class="flex-1 min-w-0">
          <span class="body-text font-medium text-foreground block">${escapeHtml(window.formatMemory(risks[0]))}</span>
          <span class="text-xs text-warning font-medium">High priority</span>
        </div>
      </div>`
    : '<div class="body-text text-muted-foreground">No known frustrations.</div>';
}

function showSkeleton(show) {
  document.querySelectorAll('.skeleton').forEach(el => {
    el.style.display = show ? '' : 'none';
    el.classList.toggle('hidden', !show);
  });
  document.querySelectorAll('.skeleton-target').forEach(el => {
    el.style.display = show ? 'none' : '';
    el.classList.toggle('hidden', show);
  });
}

function showError(msg) {
  document.querySelectorAll('.skeleton').forEach(el => {
    el.style.display = 'none';
    el.classList.add('hidden');
  });
  document.querySelectorAll('.skeleton-target').forEach(el => {
    el.style.display = '';
    el.classList.remove('hidden');
  });

  const targets = [
    document.getElementById('timeline-container'),
    document.getElementById('memory-graph-container'),
    document.querySelector('.skeleton-target'),
    document.querySelector('main'),
    document.body,
  ];

  const errorHtml = `
    <div style="padding:32px;text-align:center;
                color:var(--color-muted-foreground,#6b7280)">
      <div style="font-size:32px;margin-bottom:12px">⚠</div>
      <div style="font-size:15px;font-weight:500;
                  color:var(--color-foreground,#111);
                  margin-bottom:6px">
        Failed to load
      </div>
      <div style="font-size:13px">${escapeHtml(msg)}</div>
      <button onclick="window.history.back()"
        style="margin-top:16px;padding:8px 16px;
               border-radius:8px;border:none;cursor:pointer;
               background:var(--color-primary,#6366f1);
               color:white;font-size:13px">
        ← Go back
      </button>
    </div>`;

  for (const el of targets) {
    if (el) {
      el.innerHTML = errorHtml;
      break;
    }
  }
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderDots(pct) {
  const active = Math.round(pct / 20);
  return Array.from({ length: 5 }, (_, i) =>
    `<div class="confidence-dot${i < active ? ' active' : ''}"></div>`
  ).join('');
}

function computeConfidence(memory) {
  return memory.id ? 80 + (memory.id.charCodeAt(memory.id.length - 1) % 20) : 85;
}

function wireBackBtn() {
  const btn = document.getElementById('backBtn');
  if (btn) {
    btn.addEventListener('click', () => window.history.back());
  }
}

function wireStartSession() {
  const btn = document.getElementById('startSessionBtn');
  if (btn && CUSTOMER_ID) {
    btn.addEventListener('click', () => {
      window.location.href = `./liveagent.html?customer_id=${CUSTOMER_ID}`;
    });
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
