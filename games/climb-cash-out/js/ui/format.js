export function fmtChips(cents) {
  return (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtSigned(cents) {
  if (cents === 0) return '0.00';
  return (cents > 0 ? '+' : '−') + fmtChips(Math.abs(cents));
}

/** 2.97× / 237× ; compact drops decimals for big values so they fit in a square. */
export function fmtMult(m, compact = false) {
  if (compact) {
    // Round down, never up: a prize must not look bigger than it is.
    if (m >= 100) return `${Math.floor(m).toLocaleString('en-US')}×`;
    if (m >= 10) return `${(Math.floor(m * 10) / 10).toFixed(1)}×`;
  }
  return `${m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×`;
}

export function fmtOdds(x) {
  return `1 in ${Math.round(x).toLocaleString('en-US')}`;
}

export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
