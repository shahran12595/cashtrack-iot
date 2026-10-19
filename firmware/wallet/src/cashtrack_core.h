// CashTrack IoT firmware core: hardware-independent logic shared by the wallet and vault.
// Compiles on the ESP32-S3 (Arduino core 3.x) and on a PC for unit tests (firmware/test).
// Mirrors core/src/direction.js, recognition.js and dispense.js.
#pragma once
#include <stdint.h>
#include <stddef.h>

namespace cashtrack {

// ---------- Currencies ----------
enum Currency : uint8_t { BDT = 0, USD = 1, CNY = 2, CURRENCY_COUNT = 3 };
const char* currencyCode(Currency c);
bool isValidNote(Currency c, uint16_t value);

// ---------- IR direction ----------
enum class Direction : uint8_t { NONE, IN, OUT, UNKNOWN };
const char* directionName(Direction d);

constexpr float BLOCK_THRESHOLD = 0.6f;     // blocked below 60% of the clear level
constexpr uint32_t PASS_TIMEOUT_MS = 3000;  // a pass slower than this is UNKNOWN

inline bool isBlocked(uint16_t level, uint16_t baseline) { return level < baseline * BLOCK_THRESHOLD; }

class DirectionDetector {
 public:
  // Feed a beam change (beam 1 = outer, 2 = inner). Returns NONE until a pass completes.
  Direction feed(uint8_t beam, bool blocked, uint32_t nowMs);
  void reset();
 private:
  bool blocked_[3] = {false, false, false};
  uint8_t first_ = 0, lastCleared_ = 0;
  uint32_t start_ = 0;
};

// ---------- Recognition decision ----------
constexpr float MIN_CONFIDENCE = 0.80f;
enum class Action : uint8_t { COUNT, CONFIRM, SUSPECT, IGNORE };
const char* actionName(Action a);

struct Prediction {
  bool isNote;        // false for "no_note" / "other_object"
  Currency cur;
  uint16_t value;
  float confidence;
};

Action decide(Direction dir, const Prediction& p, bool uvPass);

// ---------- Event message (sent encrypted over BLE) ----------
// Writes e.g. {"seq":1042,"evt":"IN","cur":"BDT","val":500,"conf":0.97}. Returns length or -1.
int encodeEvent(char* out, size_t cap, uint32_t seq, Direction dir, Action a, const Prediction& p);

// ---------- Vault dispense plan ----------
constexpr int CASSETTES_PER_CURRENCY = 4;
const uint16_t* vaultNotes(Currency c);  // largest first, 4 values

// counts[i] = notes in the cassette for vaultNotes(c)[i]. On success fills take[i] and returns true.
// Finds the plan with the fewest notes (greedy alone can fail, e.g. 600 from 1×500 + 3×200).
bool planWithdrawal(Currency c, uint32_t amount, const uint16_t counts[CASSETTES_PER_CURRENCY],
                    uint16_t take[CASSETTES_PER_CURRENCY]);

}  // namespace cashtrack
