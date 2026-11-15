// Play-money wallet, history, seeds and settings, saved in this browser.
// Every storage access is wrapped: private windows or blocked storage just mean nothing persists.

const KEY = 'climb-cash-out:v1';
export const START_BALANCE_CENTS = 100000; // 1,000 chips
export const REFILL_BELOW_CENTS = 10000;   // refill offered when balance is under 100 chips
export const REFILL_EVERY_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY = 100;
const MAX_LEDGER = 300;

export function defaultState() {
  return {
    balanceCents: START_BALANCE_CENTS,
    ledger: [],          // { at, type: 'bet'|'payout'|'refill', cents, roundId }
    history: [],         // finished rounds, newest first
    seeds: null,         // { serverSeed, serverHash, clientSeed, nonce }
    revealed: {},        // serverHash -> serverSeed, once rotated
    activeRound: null,
    lastRefillAt: 0,
    prefs: { stakeCents: 500, risk: 'medium', autoOn: false, autoTarget: 2, ladders: {} },
    // reducedMotion starts unset so the first load can follow the device's own setting
    settings: { showValues: 'auto', reducedMotion: undefined, realityMinutes: 30 },
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const saved = JSON.parse(raw);
    const base = defaultState();
    return {
      ...base, ...saved,
      prefs: { ...base.prefs, ...(saved.prefs || {}) },
      settings: { ...base.settings, ...(saved.settings || {}) },
    };
  } catch {
    return defaultState();
  }
}

export function save(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

export function addLedger(state, type, cents, roundId) {
  state.ledger.unshift({ at: Date.now(), type, cents, roundId });
  if (state.ledger.length > MAX_LEDGER) state.ledger.length = MAX_LEDGER;
}

export function debit(state, cents, roundId, type = 'bet') {
  if (cents > state.balanceCents) throw new Error('Not enough chips');
  state.balanceCents -= cents;
  addLedger(state, type, -cents, roundId);
}

export function credit(state, cents, roundId, type = 'payout') {
  state.balanceCents += cents;
  addLedger(state, type, cents, roundId);
}

export function canRefill(state, now = Date.now()) {
  return state.balanceCents < REFILL_BELOW_CENTS && now - (state.lastRefillAt || 0) >= REFILL_EVERY_MS;
}

export function refill(state, now = Date.now()) {
  if (!canRefill(state, now)) return false;
  const add = START_BALANCE_CENTS - state.balanceCents;
  credit(state, add, null, 'refill');
  state.lastRefillAt = now;
  return true;
}

export function pushHistory(state, round) {
  state.history.unshift(round);
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
}
