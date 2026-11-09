/* global sabir, sabirLogo, sabirIcon, ICONS, esc, hhmm */
document.getElementById('settings').innerHTML = sabirIcon(ICONS.settings, 18);
document.getElementById('settings').onclick = () => sabir.action('open:main', 'settings');
document.getElementById('open').onclick = (e) => { e.preventDefault(); sabir.action('open:main', 'activity'); };
document.getElementById('pause').onclick = () => sabir.action('pause:toggle');
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') sabir.action('tray:hide'); });

function stripApp(title, app) {
  return String(title || '').replace(new RegExp('\\s+[-–—]\\s+' + app.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'), '');
}

let hero = '';
function render(S) {
  let t, sub, dot, still;
  if (S.paused) { t = 'Sabir is paused'; sub = 'Agents can’t use any app right now'; dot = 'hollow'; still = true; }
  else if (S.working) { t = `${S.working.agent} is working`; const w = stripApp(S.working.title, S.working.appName); sub = S.working.appName + (w ? ' · ' + w : ''); dot = 'green'; still = false; }
  else { t = 'Sabir is ready'; sub = 'Waiting for an agent'; dot = 'hollow'; still = true; }
  const key = [t, sub, dot, still].join('|');
  if (key !== hero) {
    hero = key;
    const h = document.getElementById('hero');
    if (!h.querySelector('svg')) h.innerHTML = sabirLogo(124, 110, true) + '<div class="t"></div><div class="s"><div class="dot"></div><span></span></div>';
    h.classList.toggle('still', still);
    h.querySelector('.t').textContent = t;
    h.querySelector('.s .dot').className = 'dot ' + dot;
    h.querySelector('.s span').textContent = sub;
  }
  document.getElementById('agents').innerHTML = S.agents.slice(0, 3).map((a) => {
    const on = a.status !== 'Disconnected';
    return `<div class="arow"><div class="dot ${on ? 'green' : 'hollow'}"></div><div class="n">${esc(a.name)}</div><div class="st" style="color: ${on ? '#3F7A6D' : '#6B5F4E'}">${a.status}</div></div>`;
  }).join('');
  const items = S.activity.slice(0, 3);
  document.getElementById('items').innerHTML = items.length ? items.map((a) =>
    `<div class="item"><div class="tm">${hhmm(a.time)}</div><div class="b"><div class="a" title="${esc(a.action)}">${esc(a.action)}</div><div class="m">${esc(a.agent)} · ${esc(a.app)}</div></div></div>`).join('')
    : '<div class="empty">No activity yet.</div>';
  // show only entries that fit completely above the footer
  const box = document.querySelector('.act');
  const list = document.getElementById('items');
  for (const el of [...list.children].reverse()) {
    if (el.offsetTop + el.offsetHeight <= box.offsetTop + box.clientHeight || list.children.length === 1) break;
    el.remove();
  }
  document.getElementById('pause').innerHTML = S.paused ? sabirIcon(ICONS.play, 16) + 'Resume' : sabirIcon(ICONS.pause, 16) + 'Pause';
}
sabir.onState(render);
sabir.state().then(render);
