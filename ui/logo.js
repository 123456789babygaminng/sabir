// Sabir logo: brass gear (18 teeth, clockwise, 18 s) and green gear (10 teeth, counter-clockwise, 10 s).
(function () {
  // Demo/ad hook: when a page is embedded by a host page that provides sabirMock (and the
  // real preload bridge is absent), take the state from the host instead of the app.
  try {
    if (!window.sabir && window.parent !== window && window.parent.sabirMock) window.sabir = window.parent.sabirMock(document.title, window);
  } catch (e) { /* cross-origin parent: ignore */ }
  const A = 'M184.4 103.9 L186.5 107.1 L201.6 101.7 L205.1 109.2 L191.3 117.3 L192.4 121.0 L193.3 124.6 L209.2 124.8 L210.0 133.0 L194.2 135.9 L194.0 139.7 L193.6 143.5 L208.6 149.1 L206.4 157.1 L190.6 154.4 L189.2 157.9 L187.4 161.3 L199.6 171.7 L194.9 178.5 L180.9 170.6 L178.4 173.4 L175.6 175.9 L183.5 189.9 L176.7 194.6 L166.3 182.4 L162.9 184.2 L159.4 185.6 L162.1 201.4 L154.1 203.6 L148.5 188.6 L144.7 189.0 L140.9 189.2 L138.0 205.0 L129.8 204.2 L129.6 188.3 L126.0 187.4 L122.3 186.3 L114.2 200.1 L106.7 196.6 L112.1 181.5 L108.9 179.4 L105.9 177.2 L93.5 187.3 L87.7 181.5 L97.8 169.1 L95.6 166.1 L93.5 162.9 L78.4 168.3 L74.9 160.8 L88.7 152.7 L87.6 149.0 L86.7 145.4 L70.8 145.2 L70.0 137.0 L85.8 134.1 L86.0 130.3 L86.4 126.5 L71.4 120.9 L73.6 112.9 L89.4 115.6 L90.8 112.1 L92.6 108.7 L80.4 98.3 L85.1 91.5 L99.1 99.4 L101.6 96.6 L104.4 94.1 L96.5 80.1 L103.3 75.4 L113.7 87.6 L117.1 85.8 L120.6 84.4 L117.9 68.6 L125.9 66.4 L131.5 81.4 L135.3 81.0 L139.1 80.8 L142.0 65.0 L150.2 65.8 L150.4 81.7 L154.0 82.6 L157.7 83.7 L165.8 69.9 L173.3 73.4 L167.9 88.5 L171.1 90.6 L174.1 92.8 L186.5 82.7 L192.3 88.5 L182.2 100.9 Z';
  const B = 'M204.5 99.8 L202.0 97.6 L188.6 106.4 L183.5 99.1 L196.3 89.5 L195.2 86.5 L194.4 83.3 L178.4 82.5 L178.6 73.6 L194.6 73.4 L195.5 70.2 L196.7 67.2 L184.2 57.2 L189.6 50.1 L202.6 59.3 L205.2 57.3 L208.0 55.6 L203.8 40.2 L212.3 37.5 L217.4 52.7 L220.7 52.5 L224.0 52.8 L229.6 37.8 L238.1 40.8 L233.3 56.0 L236.1 57.8 L238.6 60.0 L251.9 51.2 L257.1 58.5 L244.2 68.0 L245.4 71.1 L246.1 74.3 L262.1 75.0 L262.0 84.0 L246.0 84.2 L245.1 87.3 L243.8 90.4 L256.3 100.3 L250.9 107.5 L237.9 98.2 L235.3 100.3 L232.5 102.0 L236.8 117.4 L228.2 120.0 L223.1 104.9 L219.8 105.0 L216.5 104.8 L210.9 119.7 L202.4 116.8 L207.2 101.6 Z';
  window.sabirLogo = function (w, h, animated = true) {
    return `<svg width="${w}" height="${h}" viewBox="64 30 204 182" aria-hidden="true">` +
      `<g${animated ? ' class="gA"' : ''}><path d="${A}" fill="#B08D57"></path><circle cx="140" cy="135" r="44" fill="none" stroke="#1E1C1A" stroke-width="2"></circle>` +
      `<text x="140" y="138" font-family="Cinzel, serif" font-weight="600" font-size="48" fill="#1E1C1A" text-anchor="middle" dominant-baseline="central">S</text></g>` +
      `<g${animated ? ' class="gB"' : ''}><path d="${B}" fill="#3F7A6D"></path><circle cx="220.3" cy="78.8" r="20" fill="none" stroke="#EDE4D3" stroke-width="1.5"></circle></g></svg>`;
  };
  window.sabirIcon = function (path, size = 18, stroke = '#1E1C1A') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  };
  window.ICONS = {
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"></path>',
    overview: '<path d="M4 11l8-7 8 7v9H4z"></path>',
    activity: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"></path>',
    permissions: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"></path>',
    minimize: '<path d="M6 12h12"></path>',
    maximize: '<rect x="6" y="6" width="12" height="12"></rect>',
    close: '<path d="M6 6l12 12M18 6L6 18"></path>',
    pause: '<path d="M9 5v14M15 5v14"></path>',
    play: '<path d="M8 5l11 7-11 7z"></path>',
    check: '<path d="M5 12l5 5 9-10"></path>',
  };
  window.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  };
  window.hhmm = function (t) {
    const d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
})();
