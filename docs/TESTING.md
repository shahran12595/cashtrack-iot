# Test cases

CashTrack IoT has 74 automated test cases in four suites, plus hardware acceptance tests for the assembled prototype. Every automated case below runs in CI on each push.

| Suite | ID prefix | Run with | Count |
|---|---|---|---|
| Core unit tests | UT | `npm run test:unit` | 47 |
| Backend integration tests | IT | `npm run test:unit` | 8 |
| Firmware core tests (C++, on a PC) | FT | `npm run test:firmware` | 6 (26 checks) |
| Simulator end-to-end tests (browser) | E2E | `npm run test:e2e` | 13 |
| Firmware build for ESP32-S3 | — | CI job `firmware-build` | 1 |
| Hardware acceptance | HW | by hand, on the prototype | 15 |

## Core unit tests (`core/test/`)

### Currencies (`currency.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-01 | Note keys encode currency and value | `noteKey('BDT', 500)`, `'BDT', 25`, `'EUR', 10` | `"BDT:500"`; unknown notes throw |
| UT-02 | Balances kept per currency | ৳500 + 3×৳100 + 2×$20 + ¥50 | `{BDT: 800, USD: 40, CNY: 50}` |
| UT-03 | Taking out taka changes only taka | remove one ৳500 | USD and CNY unchanged; input not mutated |
| UT-04 | Removing a missing note | remove ৳500 from `{BDT:100: 1}` | throws |
| UT-05 | Converted total only on request | ৳1000 + $10 + ¥100 in BDT | ৳3,920 at sample rates; missing rate throws |
| UT-06 | Formatting | 12600 BDT, 20 USD, −50 CNY | `৳12,600`, `$20`, `−¥50` |

### IR direction (`direction.test.js`)

| ID | Test | Beam events | Expected |
|---|---|---|---|
| UT-07 | Blocked threshold | level 590 / 600 of baseline 1000 | blocked / clear |
| UT-08 | Note going in | 1↓ 2↓ 1↑ 2↑ | `IN` |
| UT-09 | Note going out | 2↓ 1↓ 2↑ 1↑ | `OUT` |
| UT-10 | Pushed halfway, pulled back | 1↓ 2↓ 2↑ 1↑ | `UNKNOWN` (not counted) |
| UT-11 | Only one beam broken | 1↓ 1↑ | `UNKNOWN` |
| UT-12 | Pass slower than 3 s | pass of 3.5 s | `UNKNOWN` |
| UT-13 | Noise and passes in a row | repeated reading, then IN, then OUT | `['IN', 'OUT']` |

### Counting rule (`recognition.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-14 | Model labels | `USD:20`, `no_note`, `BDT:30` | parsed; null; throws |
| UT-15 | All checks agree | IN, BDT:500 at 0.97, UV pass | `COUNT` |
| UT-16 | Low confidence | 0.62 (and exactly 0.80) | `CONFIRM` (0.80 counts) |
| UT-17 | UV fails | IN, UV fail | `SUSPECT`, never counted |
| UT-18 | Unclear direction | `UNKNOWN` | `CONFIRM` |
| UT-19 | Out of a note not held | OUT USD:50, wallet has only USD:20 | `CONFIRM` |
| UT-20 | Nothing in view | `no_note` | `IGNORE` |

### Vault dispensing (`dispense.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-21 | Fewest notes | ৳1,700; $180 | ৳1000+500+200; $100+50+20+10 |
| UT-22 | Beats greedy | ৳600 from 1×৳500 + 3×৳200 | 3×৳200 |
| UT-23 | Currency stays separate | ¥300 | yuan notes only, sum ¥300 |
| UT-24 | Validation before any prompt | ৳150, $15, $1000, 0, EUR, ৳300 from 2×৳200 | all refused with a reason; ৳2,000 accepted |

### PIN fallback (`pin.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-25 | When the PIN is offered | 2, 3 failed touches | no, yes |
| UT-26 | Weak PINs refused | 111111, 123456, 654321, 121212, 123123, 12345 | refused; 246810 accepted |
| UT-27 | PIN not stored | saved state | contains only salt and hash |
| UT-28 | Lockout | 5 wrong PINs | locked for 30 s, even the right PIN is refused |
| UT-29 | Escalation | second lockout | 60 s |
| UT-30 | Change PIN | 222222, then 730194 | refused; then only the new PIN works |

### SMS parsing (`sms.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-31 | Bank debit | DemoBank, Tk 1,250.00 at City Grocers | 1250, balance 18430.5, out, Food |
| UT-32 | Mobile wallet | MobiPay payment to RideNow, money received | Transport; Income |
| UT-33 | Unknown sender | a phone number | not read (`null`) |
| UT-34 | Unknown merchant | "Tea Stall" | category Other |

### AI coach (`coach.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-35 | Goal monthly need | laptop ৳63,000 left, 5 months; trip ¥700, 2 months | ৳12,600; ৳5,950 a month |
| UT-36 | What counts as spending | includes a vault withdrawal, a 40-day-old payment, $10 | both excluded; $10 = ৳1,220 |
| UT-37 | Suggested budgets | sample month | multiples of ৳100, wants trimmed, within the cap |
| UT-38 | Gap and headline | with and without goals | gap = need − surplus; "Add a goal…" |
| UT-39 | Saving tips | ৳2,750 cash food spend | round-up ৳50, lunch ৳550, watch Food (92%) |
| UT-40 | AI privacy | summary for the AI | no sources or places; has goal needs |
| UT-41 | Built-in answers | "How can I save for my laptop?" | mentions ৳12,600 a month |

### Security (`secure.test.js`)

| ID | Test | Input | Expected |
|---|---|---|---|
| UT-42 | Canonical JSON | same object, different key order | same bytes |
| UT-43 | Valid withdrawal | phone + backend signatures | accepted once; replay refused |
| UT-44 | Bad commands | expired, no backend signature, attacker keys | refused with the exact reason |
| UT-45 | Hacked backend | changes amount, currency or vault | refused |
| UT-46 | Wallet events | replayed, forged and tampered packets | all refused |
| UT-47 | Firmware packet format | iv \| ciphertext \| tag bytes | decoded; short packet refused |

## Backend integration tests (`backend/test/`)

| ID | Test | Expected |
|---|---|---|
| IT-01 | `GET /health` | 200 |
| IT-02 | ৳1,500 request signed by the phone | 200, plan ৳1000+৳500, the vault verifier accepts it |
| IT-03 | Same signed request sent twice | 409 the second time |
| IT-04 | Request signed by an unknown key | 401 |
| IT-05 | ৳150 or $500 | 422 |
| IT-06 | Daily limit ৳10,000 across currencies | ৳1,500 + $20 + ৳5,000 allowed; then $50 refused (403); allowed the next day |
| IT-07 | Invalid JSON, empty body, 20 KB body, unknown path | 400, 400, 413, 404; the server keeps running |
| IT-08 | Request issued 10 minutes ago | 400 |

## Firmware core tests (`firmware/test/test_core.cpp`)

These run the same C++ code that is compiled for the ESP32-S3.

| ID | Test | Expected |
|---|---|---|
| FT-01 | Blocked threshold | below 60% of baseline is blocked |
| FT-02 | IN and OUT passes | IN, then OUT |
| FT-03 | Halfway, slow and one-beam passes | UNKNOWN each time |
| FT-04 | Counting rule | COUNT, SUSPECT, COUNT (UV ignored on OUT), CONFIRM, CONFIRM, IGNORE, IGNORE |
| FT-05 | Event JSON | exact bytes for IN, SUSPECT and IN?; never overflows a small buffer |
| FT-06 | Dispense plan | ৳1,700; ৳600 beats greedy; ৳300 impossible; ¥380 |

## Simulator end-to-end tests (`e2e/simulator.spec.js`)

Each test opens the simulator in Chromium with fresh storage and fails if any JavaScript error occurs.

| ID | Test | Expected |
|---|---|---|
| E2E-01 | Home screen | three separate balances: ৳, $, ¥ |
| E2E-02 | Put a ৳500 note in the wallet | taka +500; dollar and yuan unchanged |
| E2E-03 | Put in $20 and ¥100 | each changes only its own currency |
| E2E-04 | Counterfeit ৳1000 | not counted; fake-note count +1 |
| E2E-05 | Poor lighting | "Did you add…?" prompt; counted after confirming |
| E2E-06 | Withdraw ৳2,000 with fingerprint | vault taka −2,000; dollars and yuan unchanged |
| E2E-07 | Withdraw ৳150 | refused with "multiple of ৳100", no fingerprint prompt |
| E2E-08 | Wet finger ×3, then PIN 246810 | PIN pad appears; withdrawal completes |
| E2E-09 | 5 wrong PINs | "Too many wrong PINs", lock time set |
| E2E-10 | Converted total | hidden until asked; shown in dollars |
| E2E-11 | Ask the coach about the laptop | answer gives the monthly amount for the laptop goal |
| E2E-12 | 390 px phone width | no horizontal scrolling |
| E2E-13 | Guided demo | all steps finish without errors |

## Hardware acceptance tests (prototype)

These are run by hand on the assembled wallet and vault. Targets come from the technical documentation, section 7.

| ID | Area | Test | Target |
|---|---|---|---|
| HW-01 | Note recognition | held-out test set, split by physical note | ≥ 95% accuracy |
| HW-02 | Multi-currency | mixed taka, dollar and yuan notes in and out | ≥ 95% per currency; balances change only in their own currency |
| HW-03 | Direction | 200 real insert and remove actions by hand | ≥ 98% correct direction |
| HW-04 | End to end | 200 mixed actions, then compare with a hand count | wrong in ≤ 2% of actions before recount |
| HW-05 | Counterfeit check | genuine notes vs. marked colour copies | all copies flagged; ≤ 2% of genuine notes flagged |
| HW-06 | Confirmation | low-light trials | every result below 0.80 asks the user |
| HW-07 | Vault dispensing | 100 withdrawals of mixed amounts | exact count every time; double feeds detected |
| HW-08 | Vault commands | replayed, expired, unsigned and wrongly signed | 100% rejected |
| HW-09 | PIN fallback | 3 failed fingerprints, then right and wrong PINs | PIN offered after 3 failures; lockout after 5 wrong |
| HW-10 | BLE security | spoofed events from an unpaired device | 100% rejected |
| HW-11 | Anti-theft | pick-ups with and without fingerprint | alarm within 3 s; none within the 2-minute grace period |
| HW-12 | Find my wallet | leave the wallet at known spots | last-seen place within 50 m |
| HW-13 | GPS tracker card | carried 2 km outdoors | each fix within 15 m; map updated within 2 min in live mode |
| HW-14 | Battery | simulated day of 25 openings | ≥ 3 days per charge |
| HW-15 | AI coach | 50 questions checked against the user's figures | no invented numbers; fallback answers when offline |

Counterfeit tests use only colour copies made by the team and clearly marked as copies. Possessing real counterfeit notes is a criminal offence in Bangladesh.
