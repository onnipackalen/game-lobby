// Round state machine: BET_PLACED → (roll → AWAITING_DECISION)* → CASHED_OUT | BUSTED | TOP_PRIZE.
// Pure functions over plain objects so a server can run the same code later.
// Money is kept in integer cents to avoid floating-point drift.

import { N, RTP, resolve } from './board.js';

export const STATUS = { ACTIVE: 'active', CASHED: 'cashed', BUST: 'bust', TOP: 'top' };

export function newRound({ board, stakeCents, nonce, serverHash, clientSeed }) {
  return {
    id: `${Date.now().toString(36)}-${nonce}`,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    risk: board.risk,
    ladders: { ...board.ladders },
    stakeCents,
    nonce,
    serverHash,
    clientSeed,
    pos: 1,
    rolls: [],      // [{ face, from, landed, final, kind, superRoll, feeCents }]
    feesCents: 0,   // chips spent on Super Rolls this round
    status: STATUS.ACTIVE,
    multiplier: 0,
    payoutCents: 0,
  };
}

/** Die faces that would land on a red pit from square s. */
export function bustFaces(board, s) {
  let k = 0;
  for (let d = 1; d <= 6; d++) if (resolve(board, s, d).kind === 'bust') k++;
  return k;
}

/**
 * Super Roll: pay chips so red pits can't bust you on this roll (you stay on your square instead).
 *
 * Its price is what the protection is worth, at the game's 97% return. With true square values
 * v(s) = RTP·P(s)/P(1) (a martingale), a protected roll is worth v(s)·(1 + k/6) instead of v(s),
 * where k is the number of busting faces: the protection adds stake·v(s)·k/6. Charging that
 * divided by RTP means every Super Roll returns exactly 97% on its own, so the 97% ceiling holds
 * over everything a player bets (stake + Super Rolls), whatever they do. Rounded up to whole cents.
 * Returns 0 when no face can bust (Super Roll not offered).
 */
export function superRollPriceCents(round, board) {
  if (round.status !== STATUS.ACTIVE || round.rolls.length === 0) return 0;
  const k = bustFaces(board, round.pos);
  if (k === 0) return 0;
  const added = round.stakeCents * (RTP * board.P[round.pos] / board.P[1]) * (k / 6);
  return Math.ceil(added / RTP - 1e-9);
}

/** Apply a die face. Returns the updated round and the step-by-step path for animation. */
export function applyRoll(round, board, face, { superRoll = false, feeCents = 0 } = {}) {
  if (round.status !== STATUS.ACTIVE) throw new Error('Round is over');
  const from = round.pos;
  const r = resolve(board, from, face);
  const path = stepPath(from, face);
  const roll = { face, from, landed: r.landed, final: r.final, kind: r.kind };
  if (superRoll) { roll.superRoll = true; roll.feeCents = feeCents; }
  const next = { ...round, rolls: [...round.rolls, roll], feesCents: (round.feesCents || 0) + (superRoll ? feeCents : 0), updatedAt: Date.now() };
  if (r.kind === 'bust' && superRoll) {
    // Pit blocked: stay where you were
    roll.kind = 'blocked';
    roll.final = from;
    next.pos = from;
    next.multiplier = board.m[from];
  } else if (r.kind === 'bust') {
    next.status = STATUS.BUST;
    next.pos = r.landed;
    next.multiplier = 0;
    next.payoutCents = 0;
  } else {
    next.pos = r.final;
    next.multiplier = board.m[r.final];
    if (r.final === N) {
      next.status = STATUS.TOP;
      next.payoutCents = payout(round.stakeCents, board.m[N]);
    }
  }
  return { round: next, roll, path };
}

export function cashOut(round, board) {
  if (round.status !== STATUS.ACTIVE || round.rolls.length === 0) throw new Error('Cannot cash out now');
  const multiplier = board.m[round.pos];
  return { ...round, status: STATUS.CASHED, multiplier, payoutCents: payout(round.stakeCents, multiplier), updatedAt: Date.now() };
}

export function payout(stakeCents, multiplier) {
  return Math.floor(stakeCents * Math.round(multiplier * 100) / 100);
}

/** Net result of a round for the player: payout minus stake minus Super Roll fees. */
export function roundNet(round) {
  return round.payoutCents - round.stakeCents - (round.feesCents || 0);
}

/** Squares the token passes through, one per step, including the bounce back from 100. */
export function stepPath(from, face) {
  const path = [];
  let s = from, dir = 1;
  for (let i = 0; i < face; i++) {
    if (s === N) dir = -1;
    s += dir;
    path.push(s);
  }
  return path;
}

export function isOver(round) {
  return round.status !== STATUS.ACTIVE;
}
