# Architecture

This is a short guide to how the code maps to the system. The project's technical documentation covers the full design, and the security self-assessment covers threats and risks.

## Components

| Component | Hardware / runtime | Code |
|---|---|---|
| Smart wallet | XIAO ESP32-S3 Sense, AI Vision Camera, 2 IR beams, UV LED + sensor, fingerprint module, buzzer, hall sensor, accelerometer, optional GPS tracker card | `firmware/wallet/` |
| Home vault | ESP32-S3, AI Note Scanner (camera + UV + magnetic + IR), 12 cassettes (4 each for ৳ $ ¥), dispenser with IR counter, door sensors | algorithms in `core/` and `firmware/wallet/src/`; vault sketch is the next milestone |
| Phone app | Android / iOS (planned in Flutter); simulated in `simulator/` | `simulator/index.html`, `core/` |
| Backend | Node.js 22 | `backend/` |

## Data flow for one note

1. The hall sensor wakes the wallet when it opens.
2. The firmware samples both IR beams every 2 ms. Each reading pulses the LED and subtracts the ambient reading, and a beam counts as blocked below 60% of its clear baseline.
3. When the first beam is blocked, the AI Vision Camera captures one 96 × 96 frame. The on-device model returns a label such as `CNY_100` and a confidence.
4. When both beams are clear again, `DirectionDetector` returns IN, OUT or UNKNOWN.
5. For IN, the UV LED flashes and the sensor checks for fluorescent security features.
6. `decide()` applies the rule and returns COUNT, CONFIRM, SUSPECT or IGNORE.
7. `encodeEvent()` writes `{"seq":…,"evt":"IN","cur":"CNY","val":100,"conf":0.91}`. The wallet seals it with AES-128-GCM and sends it by BLE notify.
8. The phone's `EventReceiver.openBytes()` authenticates the packet, rejects old `seq` values, and updates that currency's balance only.

## Withdrawal flow

1. The owner picks a currency and amount. `validateWithdrawal()` checks the cassette note sizes, the amount held and whether the notes can make it.
2. The phone shows the fingerprint prompt. After 3 failed touches it offers the PIN (`PinGuard`, 5 tries, then a 30-second lockout).
3. A successful check unlocks the phone key, which signs the request (`createWithdrawRequest`).
4. The backend verifies the signature, the nonce, the request's age and the daily limit, then co-signs a command with the note plan and a 60-second expiry.
5. The vault (`VaultVerifier`) checks both signatures, that the command matches the signed request, the expiry and the nonce, and only then dispenses.

## AI coach

`coach()` is deterministic and runs on the phone:

- **Monthly need per goal** = (target − saved) ÷ months left, converted to taka.
- **Gap** = total monthly need − (income − last 30 days' spending).
- **Suggested budget per category** = max(30-day spend × 1.1, floor). "Wants" are cut by 20%. If the total exceeds income minus what the goals need (at most half the income is reserved), everything is scaled down, then rounded to ৳100.
- **Tips:** each has an estimated monthly saving (round-up, cutting wants by 25%, carrying lunch, a weekly cash allowance, alerts at 80% of a budget).

For questions, `summaryForAI()` builds a figures-only summary, and only that is sent to the language model. `localAnswer()` gives a rule-based answer when the AI service is unavailable.

## Currency model

- Notes: BDT 10, 20, 50, 100, 200, 500, 1000 · USD 1, 2, 5, 10, 20, 50, 100 · CNY 1, 5, 10, 20, 50, 100.
- Vault cassettes: BDT 1000, 500, 200, 100 · USD 100, 50, 20, 10 · CNY 100, 50, 20, 10.
- Balances are always per currency. `convertedTotal()` is for display only and is never stored.
- Budgets are in taka; foreign spending is converted at the app's rates (sample rates: $1 = ৳122, ¥1 = ৳17).

## Keeping the simulator and core in step

The simulator is a single self-contained HTML file so that it can be opened anywhere, which means it carries its own copy of the algorithms. Its vault planner uses the same fewest-notes search as `core/src/dispense.js`. The end-to-end tests check its behaviour against the same rules the unit tests check in `core/`. When you change an algorithm, change it in `core/`, in `firmware/wallet/src/` and in the simulator, then run `npm run test:all`.
