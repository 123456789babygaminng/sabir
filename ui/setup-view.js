/* global sabir, sabirIcon, ICONS, esc */
let step = location.hash === '#step2' ? 2 : location.hash === '#step3' ? 3 : 1;
let S = null;
const busy = {};
const errors = {};
let copied = false;

function bars() {
  return `<div style="display: flex; gap: 6px">${[1, 2, 3].map((i) => `<div class="bar${i <= step ? ' on' : ''}"></div>`).join('')}</div>`;
}

function topBar() {
  return `<div style="display: flex; align-items: center; justify-content: space-between"><div class="label">STEP ${step} OF 3</div>${bars()}</div>`;
}

function infoCard(title, text) {
  return `<div class="card"><div class="n">${title}</div><div class="d">${text}</div></div>`;
}

function agentCard(name, desc) {
  const a = (S && S.agents.find((x) => x.name === name)) || {};
  const on = name === 'Other agent' ? copied : a.configured;
  let action;
  if (on) action = `<div class="ok">${sabirIcon(ICONS.check, 16, '#3F7A6D')}${name === 'Other agent' ? 'Config copied' : 'Connected'}</div>`;
  else if (busy[name]) action = `<button class="btn-outline" disabled style="opacity: .6">Connecting…</button>`;
  else action = `<button class="btn-outline" data-connect="${esc(name)}">Connect</button>`;
  const err = errors[name] ? `<div class="err">${esc(errors[name])}</div>` : '';
  return `<div class="card${on ? ' on' : ''}"><div class="n">${name}</div><div class="d">${desc}</div>${err}${action}</div>`;
}

function render() {
  const root = document.getElementById('root');
  let body;
  if (step === 1) {
    body = `<div class="h1">Welcome to Sabir</div>
      <div class="p">Sabir teaches your AI agents to use the apps on this PC, even apps without an API.</div>
      <div class="cards">
        ${infoCard('Learns apps', 'Looks at an app’s interface and saves what it can do as tools.')}
        ${infoCard('Asks first', 'Every agent asks you once per app: always, once, or not at all.')}
        ${infoCard('Keeps a log', 'Every action lands in the activity log, so you can see what happened.')}
      </div>`;
  } else if (step === 2) {
    body = `<div class="h1">Connect your agent</div>
      <div class="p">Connect once. After that, your agent uses Sabir on its own.</div>
      <div class="cards">
        ${agentCard('Claude', 'Claude Desktop and Claude Code')}
        ${agentCard('Codex', 'Codex CLI and app')}
        ${agentCard('Other agent', 'Any agent with MCP support')}
      </div>`;
  } else {
    body = `<div class="h1">You’re all set</div>
      <div class="p">Sabir now lives in the tray next to the clock. Restart your agent once so it picks up Sabir, then just ask it.</div>
      <div class="example"><div class="label" style="margin-bottom: 8px">TRY</div>“Open Notepad and write a shopping list for the weekend.”</div>`;
  }
  const back = step === 1 ? `<button class="back" data-nav="skip">Skip</button>` : `<button class="back" data-nav="back">Back</button>`;
  const next = `<button class="btn-primary" data-nav="next">${step === 3 ? 'Finish' : 'Next'}</button>`;
  root.innerHTML = topBar() + body + `<div class="foot">${back}${next}</div>`;
}

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-nav]');
  if (nav) {
    const n = nav.dataset.nav;
    if (n === 'next' && step < 3) step++;
    else if (n === 'back' && step > 1) step--;
    else if (n === 'next' || n === 'skip') { sabir.action('setup:finish'); return; }
    render();
    return;
  }
  const c = e.target.closest('[data-connect]');
  if (c) {
    const name = c.dataset.connect;
    delete errors[name];
    if (name === 'Other agent') { await sabir.action('snippet:copy'); copied = true; render(); return; }
    busy[name] = true; render();
    const res = await sabir.action('connect', name);
    busy[name] = false;
    if (res && res.error) errors[name] = res.error;
    render();
  }
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') sabir.action('setup:close'); });
sabir.onState((s) => { S = s; render(); });
sabir.state().then((s) => { S = s; render(); });
