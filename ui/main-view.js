/* global sabir, sabirLogo, sabirIcon, ICONS, esc, hhmm */
let S = null;
let page = 'activity';
let filter = 'All';
let notes = {};

document.getElementById('logo').innerHTML = sabirLogo(40, 35, true);
for (const b of document.querySelectorAll('.wbtn')) {
  const k = b.getAttribute('aria-label').toLowerCase();
  b.innerHTML = sabirIcon(ICONS[k], 14);
}
const NAV = { overview: 'Overview', activity: 'Activity', permissions: 'Permissions', settings: 'Settings' };
for (const a of document.querySelectorAll('.nav')) {
  const p = a.dataset.page;
  a.innerHTML = sabirIcon(ICONS[p], 18) + NAV[p];
  a.addEventListener('click', (e) => { e.preventDefault(); go(p); });
}

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  e.preventDefault();
  const payload = el.dataset.payload ? JSON.parse(el.dataset.payload) : undefined;
  const res = await sabir.action(el.dataset.act, payload);
  if (el.dataset.note) { notes[el.dataset.note] = res && res.message ? res.message : 'Done'; render(); setTimeout(() => { delete notes[el.dataset.note]; render(); }, 4000); }
});

function go(p) { page = p; render(); }

const STATUS = {
  Done: { color: '#6B5F4E', dot: 'muted' },
  Discovered: { color: '#3F7A6D', dot: 'green' },
  Permission: { color: '#B08D57', dot: 'brass' },
  Denied: { color: '#6B5F4E', dot: 'hollow' },
  Failed: { color: '#1E1C1A', dot: 'hollow ink' },
};

function header(label, title, right = '') {
  return `<div class="head"><div><div class="label">${label}</div><div class="h1">${title}</div></div>${right}</div>`;
}

function activityPage() {
  const agents = ['All', 'Claude', 'Codex'];
  for (const a of S.activity) if (!agents.includes(a.agent)) agents.push(a.agent);
  if (!agents.includes(filter)) filter = 'All';
  const chips = `<div class="chips">${agents.map((a) => `<button class="chip${a === filter ? ' on' : ''}" data-filter="${esc(a)}">${esc(a)}</button>`).join('')}</div>`;
  const items = S.activity.filter((a) => filter === 'All' || a.agent === filter);
  const rows = items.map((a) => {
    const st = STATUS[a.status] || STATUS.Done;
    const tip = a.detail ? ` title="${esc(a.detail)}"` : ` title="${esc(a.action)}"`;
    return `<div class="grid row"><div class="tm">${hhmm(a.time)}</div><div class="ag">${esc(a.agent)}</div><div>${esc(a.app)}</div><div${tip}>${esc(a.action)}</div>` +
      `<div class="st" style="color: ${st.color}"><div class="dot ${st.dot}"></div>${esc(a.status)}</div></div>`;
  }).join('');
  return header('LOGBOOK', 'Activity', chips) +
    `<div class="grid thead label"><div>TIME</div><div>AGENT</div><div>APP</div><div>ACTION</div><div>STATUS</div></div>` +
    `<div class="rows">${rows || `<div class="empty">Nothing yet. When an agent uses an app through Sabir, every action shows up here.</div>`}</div>`;
}

function overviewPage() {
  const connected = S.agents.filter((a) => a.status !== 'Disconnected').length;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const actionsToday = S.activity.filter((a) => a.time >= today.getTime()).length;
  const apps = S.apps;
  const cards = `<div class="cards">
    <div class="card"><div class="label">AGENTS CONNECTED</div><div class="num">${connected}</div></div>
    <div class="card"><div class="label">APPS LEARNED</div><div class="num">${apps.length}</div></div>
    <div class="card"><div class="label">ACTIONS TODAY</div><div class="num">${actionsToday}</div></div></div>`;
  const g = 'grid-template-columns: minmax(0, 1fr) 100px 120px 90px';
  const rows = apps.map((a) => `<div class="grid row" style="${g}"><div style="font-weight: 600">${esc(a.appName)}</div><div>${a.tools} tools</div>` +
    `<div class="tm">${a.lastUsed ? hhmm(a.lastUsed) + (new Date(a.lastUsed) < today ? ' · ' + new Date(a.lastUsed).toLocaleDateString() : '') : '—'}</div>` +
    `<div style="text-align: right"><a class="link" data-act="app:forget" data-payload='${esc(JSON.stringify(a.appKey))}'>Forget</a></div></div>`).join('');
  return header('AT A GLANCE', 'Overview') + cards +
    `<div class="section grid thead label" style="${g}; padding-top: 0"><div>LEARNED APPS</div><div>TOOLS</div><div>LAST USED</div><div></div></div>` +
    `<div class="rows">${rows || '<div class="empty">No app learned yet. The first time an agent uses an app, Sabir looks at its interface and saves what it can do as tools.</div>'}</div>`;
}

function permissionsPage() {
  const g = 'grid-template-columns: 100px minmax(0, 1fr) 140px 120px 70px';
  const rows = S.permissions.map((p) => `<div class="grid row" style="${g}"><div class="ag">${esc(p.agent)}</div><div>${esc(p.appName)}</div>` +
    `<div class="st" style="color: #3F7A6D"><div class="dot green"></div>Always allow</div><div class="tm">${new Date(p.at).toLocaleDateString()}</div>` +
    `<div style="text-align: right"><a class="link" data-act="perm:revoke" data-payload='${esc(JSON.stringify({ agent: p.agent, appKey: p.appKey }))}'>Revoke</a></div></div>`).join('');
  return header('ACCESS', 'Permissions') +
    `<div class="grid thead label" style="${g}"><div>AGENT</div><div>APP</div><div>ACCESS</div><div>SINCE</div><div></div></div>` +
    `<div class="rows">${rows || '<div class="empty">No app is always allowed yet. Agents ask the first time they want to use an app; “Allow once” lasts until the agent disconnects.</div>'}</div>`;
}

function settingsPage() {
  const agentRows = ['Claude', 'Codex', 'Gemini CLI'].map((n) => {
    const a = S.agents.find((x) => x.name === n) || { configured: false };
    const sub = { Claude: 'Claude Desktop and Claude Code', Codex: 'Codex CLI and app', 'Gemini CLI': 'Google Gemini CLI' }[n];
    const right = a.configured
      ? `<div class="ok">${sabirIcon(ICONS.check, 16, '#3F7A6D')}Connected</div>`
      : `<button class="btn-outline" data-act="connect" data-payload='${esc(JSON.stringify(n))}' data-note="c-${esc(n)}">Connect</button>`;
    return `<div class="set-row"><div class="grow"><div style="font-weight: 600">${n}</div><div class="sub">${notes['c-' + n] ? `<span class="note">${esc(notes['c-' + n])}</span>` : sub}</div></div>${right}</div>`;
  }).join('');
  return header('PREFERENCES', 'Settings') + `<div class="scroll">
    <div class="section label" style="margin-top: 22px; padding: 0 4px 10px; border-bottom: 1.5px solid #1E1C1A; font-size: 11px">AGENTS</div>
    ${agentRows}
    <div class="set-row"><div class="grow"><div style="font-weight: 600">Other agent</div><div class="sub">${notes.other ? `<span class="note">${esc(notes.other)}</span>` : 'Any agent with MCP support. Copies the MCP config to the clipboard.'}</div></div>
      <button class="btn-outline" data-act="snippet:copy" data-note="other">Copy config</button></div>
    <div class="section label" style="padding: 0 4px 10px; border-bottom: 1.5px solid #1E1C1A; font-size: 11px">CONNECTION</div>
    <div class="set-row"><div class="grow"><div style="font-weight: 600">MCP endpoint</div><div class="sub mono">${esc(S.config.url)}</div></div>
      <button class="btn-outline" data-act="copy:url" data-note="url">${notes.url ? 'Copied' : 'Copy'}</button></div>
    <div class="section label" style="padding: 0 4px 10px; border-bottom: 1.5px solid #1E1C1A; font-size: 11px">GENERAL</div>
    <div class="set-row"><div class="grow"><div style="font-weight: 600">Start with Windows</div><div class="sub">Sabir starts quietly in the tray when you sign in.</div></div>
      <button class="btn-outline" data-act="settings:autostart" data-payload="${!S.config.autostart}">${S.config.autostart ? 'On' : 'Off'}</button></div>
    <div class="set-row"><div class="grow"><div style="font-weight: 600">Setup</div><div class="sub">Walk through connecting your agents again.</div></div>
      <button class="btn-outline" data-act="open:setup">Run setup</button></div>
    <div class="set-row"><div class="grow"><div style="font-weight: 600">Activity log</div><div class="sub">${notes.clear ? `<span class="note">${esc(notes.clear)}</span>` : `${S.activityCount} entries are stored on this PC.`}</div></div>
      <button class="btn-outline" data-act="activity:clear" data-note="clear">Clear log</button></div>
    <div class="empty" style="padding-top: 18px">Sabir ${esc(S.version)} · Data folder: <span class="mono">${esc(S.config.dataDir)}</span></div>
  </div>`;
}

function render() {
  if (!S) return;
  for (const a of document.querySelectorAll('.nav')) a.classList.toggle('on', a.dataset.page === page);
  const n = S.agents.filter((a) => a.status !== 'Disconnected').length;
  document.getElementById('agents-count').textContent = `${n} agent${n === 1 ? '' : 's'} connected`;
  document.getElementById('agents-dot').className = 'dot ' + (n ? 'green' : 'hollow');
  document.querySelector('.brand').classList.toggle('still', !!S.paused);
  const c = document.getElementById('content');
  const prevScroll = (c.querySelector('.rows, .scroll') || {}).scrollTop || 0;
  c.innerHTML = { activity: activityPage, overview: overviewPage, permissions: permissionsPage, settings: settingsPage }[page]();
  const sc = c.querySelector('.rows, .scroll');
  if (sc) sc.scrollTop = prevScroll;
  for (const b of c.querySelectorAll('[data-filter]')) b.addEventListener('click', () => { filter = b.dataset.filter; render(); });
}

sabir.onState((s) => { S = s; render(); });
sabir.onEvent((name, payload) => { if (name === 'go') go(payload); });
sabir.state().then((s) => { S = s; render(); });
window.addEventListener('keydown', (e) => { if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) e.preventDefault(); });
