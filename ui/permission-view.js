/* global sabir, sabirLogo, esc */
document.getElementById('logo').innerHTML = sabirLogo(56, 49, false);
let current = null;
for (const b of document.querySelectorAll('[data-d]')) {
  b.addEventListener('click', () => {
    if (!current) return;
    const id = current.id;
    current = null;
    sabir.action('perm:answer', { id, decision: b.dataset.d });
  });
}
sabir.onEvent((name, req) => {
  if (name !== 'perm:show') return;
  current = req;
  document.getElementById('title').innerHTML = `${esc(req.agent)} wants to use <span>${esc(req.appName)}</span>`;
  document.getElementById('desc').textContent = req.firstTime
    ? 'First time. Sabir will look at the interface and learn what it can do.'
    : `Sabir already knows ${req.toolCount} function${req.toolCount === 1 ? '' : 's'} of ${req.appName}.`;
});
