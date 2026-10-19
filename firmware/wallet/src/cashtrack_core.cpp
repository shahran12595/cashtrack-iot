#include "cashtrack_core.h"
#include <stdio.h>

namespace cashtrack {

static const char* CODES[] = {"BDT", "USD", "CNY"};
static const uint16_t NOTES_BDT[] = {10, 20, 50, 100, 200, 500, 1000};
static const uint16_t NOTES_USD[] = {1, 2, 5, 10, 20, 50, 100};
static const uint16_t NOTES_CNY[] = {1, 5, 10, 20, 50, 100};
static const uint16_t VAULT[3][CASSETTES_PER_CURRENCY] = {{1000, 500, 200, 100}, {100, 50, 20, 10}, {100, 50, 20, 10}};

const char* currencyCode(Currency c) { return c < CURRENCY_COUNT ? CODES[c] : "???"; }

bool isValidNote(Currency c, uint16_t v) {
  const uint16_t* list; size_t n;
  switch (c) {
    case BDT: list = NOTES_BDT; n = 7; break;
    case USD: list = NOTES_USD; n = 7; break;
    case CNY: list = NOTES_CNY; n = 6; break;
    default: return false;
  }
  for (size_t i = 0; i < n; i++) if (list[i] == v) return true;
  return false;
}

const char* directionName(Direction d) {
  switch (d) {
    case Direction::IN: return "IN";
    case Direction::OUT: return "OUT";
    case Direction::UNKNOWN: return "UNKNOWN";
    default: return "NONE";
  }
}

void DirectionDetector::reset() {
  blocked_[1] = blocked_[2] = false;
  first_ = lastCleared_ = 0;
  start_ = 0;
}

Direction DirectionDetector::feed(uint8_t beam, bool blocked, uint32_t now) {
  if (beam != 1 && beam != 2) return Direction::NONE;
  if (blocked_[beam] == blocked) return Direction::NONE;  // no change
  if (blocked) {
    if (first_ == 0) { first_ = beam; start_ = now; }
    blocked_[beam] = true;
    return Direction::NONE;
  }
  blocked_[beam] = false;
  lastCleared_ = beam;
  if (blocked_[1] || blocked_[2]) return Direction::NONE;
  Direction r = Direction::UNKNOWN;
  if (now - start_ <= PASS_TIMEOUT_MS) {
    if (first_ == 1 && lastCleared_ == 2) r = Direction::IN;
    else if (first_ == 2 && lastCleared_ == 1) r = Direction::OUT;
  }
  reset();
  return r;
}

const char* actionName(Action a) {
  switch (a) {
    case Action::COUNT: return "COUNT";
    case Action::CONFIRM: return "CONFIRM";
    case Action::SUSPECT: return "SUSPECT";
    default: return "IGNORE";
  }
}

Action decide(Direction dir, const Prediction& p, bool uvPass) {
  if (!p.isNote || !isValidNote(p.cur, p.value)) return Action::IGNORE;
  if (dir != Direction::IN && dir != Direction::OUT) return Action::CONFIRM;
  if (dir == Direction::IN && !uvPass) return Action::SUSPECT;
  if (p.confidence < MIN_CONFIDENCE) return Action::CONFIRM;
  return Action::COUNT;
}

int encodeEvent(char* out, size_t cap, uint32_t seq, Direction dir, Action a, const Prediction& p) {
  const char* evt;
  char buf[12];
  if (a == Action::SUSPECT) evt = "SUSPECT";
  else if (a == Action::CONFIRM) { snprintf(buf, sizeof buf, "%s?", dir == Direction::OUT ? "OUT" : "IN"); evt = buf; }
  else if (a == Action::COUNT) evt = directionName(dir);
  else return -1;
  int n = (a == Action::SUSPECT)
      ? snprintf(out, cap, "{\"seq\":%lu,\"evt\":\"%s\",\"cur\":\"%s\",\"val\":%u,\"uv\":false}",
                 (unsigned long)seq, evt, currencyCode(p.cur), (unsigned)p.value)
      : snprintf(out, cap, "{\"seq\":%lu,\"evt\":\"%s\",\"cur\":\"%s\",\"val\":%u,\"conf\":%.2f}",
                 (unsigned long)seq, evt, currencyCode(p.cur), (unsigned)p.value, (double)p.confidence);
  return (n < 0 || (size_t)n >= cap) ? -1 : n;
}

const uint16_t* vaultNotes(Currency c) { return VAULT[c < CURRENCY_COUNT ? c : 0]; }

// Depth-first search over the 4 cassettes, largest note first, keeping the plan with the fewest notes.
static void search(const uint16_t* v, const uint16_t* counts, int i, uint32_t rem, uint32_t used,
                   uint16_t* cur, uint16_t* best, uint32_t* bestUsed) {
  if (rem == 0) {
    if (used < *bestUsed) { *bestUsed = used; for (int k = 0; k < CASSETTES_PER_CURRENCY; k++) best[k] = cur[k]; }
    return;
  }
  if (i == CASSETTES_PER_CURRENCY || used >= *bestUsed) return;
  uint32_t maxK = rem / v[i];
  if (maxK > counts[i]) maxK = counts[i];
  for (int32_t k = (int32_t)maxK; k >= 0; k--) {
    cur[i] = (uint16_t)k;
    search(v, counts, i + 1, rem - (uint32_t)k * v[i], used + (uint32_t)k, cur, best, bestUsed);
  }
  cur[i] = 0;
}

bool planWithdrawal(Currency c, uint32_t amount, const uint16_t counts[CASSETTES_PER_CURRENCY],
                    uint16_t take[CASSETTES_PER_CURRENCY]) {
  if (c >= CURRENCY_COUNT || amount == 0) return false;
  uint16_t cur[CASSETTES_PER_CURRENCY] = {0, 0, 0, 0};
  uint32_t bestUsed = UINT32_MAX;
  for (int k = 0; k < CASSETTES_PER_CURRENCY; k++) take[k] = 0;
  search(vaultNotes(c), counts, 0, amount, 0, cur, take, &bestUsed);
  return bestUsed != UINT32_MAX;
}

}  // namespace cashtrack
