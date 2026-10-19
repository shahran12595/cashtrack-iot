# Deployment guide

This guide covers the four deployable parts of CashTrack IoT: the simulator, the backend, the wallet firmware and the note model.

## 1. Simulator on GitHub Pages

The simulator is one self-contained file, `simulator/index.html`. It has no build step.

**One-time setup**

1. Push the repository to GitHub.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**.

**Deploying:** every push to `main` that changes `simulator/` runs `.github/workflows/pages.yml`. You can also run it by hand from the **Actions** tab (**Deploy simulator to GitHub Pages → Run workflow**). The site appears at `https://<your-account>.github.io/cashtrack-iot/`.

**Other hosts:** copy `simulator/index.html` to any static host (Netlify, Vercel, Firebase Hosting, an S3 bucket) or open it straight from disk.

**AI coach outside Claude:** in the claude.ai version of the simulator, the coach's chat answers come from a live AI model. Hosted anywhere else, the page automatically uses the built-in rule-based coach. To add a live model on your own host, put a small server endpoint in front of an LLM API and call it from `askCoach()` with the output of `coachPrompt()`. Never put an API key in the HTML.

## 2. Backend (withdrawal co-signing service)

The backend checks a withdrawal request signed by the owner's phone, applies the daily limit and the single-use nonce, and co-signs the command for the vault. It needs no npm packages.

### Keys

```bash
npm run keys        # writes keys/backend-*.pem and keys/phone-*.pem (git-ignored)
```

- Give `keys/backend-public.pem` to the vault firmware. It verifies the backend's signature with it.
- In the real app, the phone key is created inside Android Keystore or the iOS Secure Enclave and only its public key is registered. The generated `phone-private.pem` is for testing only.

### Run with Node

```bash
cp .env.example .env          # then edit the values
npm run start:env             # reads .env (Node 22+)
curl http://localhost:3000/health
```

| Variable | Meaning | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | `production` refuses to start without real keys | — |
| `VAULT_ID` | ID of the vault this backend serves | `vault-1` |
| `DAILY_LIMIT_BDT` | Daily withdrawal limit in taka (all currencies converted) | `20000` |
| `PHONE_PUBLIC_KEY` | Path to, or PEM of, the owner's phone public key | dev key |
| `BACKEND_PRIVATE_KEY` | Path to, or PEM of, the backend signing key | dev key |
| `VAULT_INVENTORY` | JSON note counts, e.g. `{"BDT:1000":4}` | sample stock |

### Run with Docker

```bash
docker build -t cashtrack-backend .
docker run -d --name cashtrack -p 3000:3000 \
  -e NODE_ENV=production \
  -e PHONE_PUBLIC_KEY="$(cat keys/phone-public.pem)" \
  -e BACKEND_PRIVATE_KEY="$(cat keys/backend-private.pem)" \
  cashtrack-backend
```

### API

| Method | Path | Body | Result |
|---|---|---|---|
| `GET` | `/health` | — | `{"ok":true}` |
| `POST` | `/api/withdrawals` | `{request, phoneSig}` from `createWithdrawRequest()` | `200` with `{request, phoneSig, command, backendSig}`; `401` bad signature; `409` nonce reused; `422` amount cannot be dispensed; `403` daily limit |
| `GET` | `/api/audit` | — | Log of co-signed and rejected requests |

**Production checklist**

- Serve over HTTPS only, behind a reverse proxy (Caddy, Nginx) or a platform such as Render, Railway or Fly.io.
- Keep `BACKEND_PRIVATE_KEY` in the host's secret store or a managed KMS, never in the image or the repo.
- Protect `/api/audit` with authentication (it is open in the prototype).
- Persist used nonces and the day's withdrawals in a database. The prototype keeps them in memory, so a restart forgets them. The vault's own nonce check still blocks replays.
- Report the vault's real note counts over MQTT/TLS instead of `VAULT_INVENTORY`.

## 3. Wallet firmware (XIAO ESP32-S3 Sense)

### Hardware and wiring

| Part | XIAO pin | GPIO |
|---|---|---|
| IR LED driver (both LEDs, through a transistor) | D0 | 1 |
| IR receiver, beam 1 (outer) | A1 | 2 |
| IR receiver, beam 2 (inner) | A2 | 3 |
| UV LED, 365 nm (through a transistor) | D3 | 4 |
| UV sensor (phototransistor behind a filter) | A4 | 5 |
| Hall sensor (LOW = closed; wake pin) | D5 | 6 |
| Piezo buzzer | D8 | 7 |
| Fingerprint touch output | D9 | 8 |
| Accelerometer motion interrupt | D10 | 9 |
| Fingerprint UART TX / RX (R503-class) | D6 / D7 | 43 / 44 |
| Camera | Sense expansion board | built in |

Pins are set in `firmware/wallet/config.h`.

### Build and flash with Arduino IDE 2

1. **File → Preferences → Additional boards manager URLs:** add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`.
2. **Tools → Board → Boards Manager:** install **esp32 by Espressif Systems**, version **3.0.7**.
3. **Sketch → Include Library → Manage Libraries:** install **Adafruit Fingerprint Sensor Library**.
4. Open `firmware/wallet/wallet.ino`.
5. Select **Tools → Board → XIAO_ESP32S3**, then set **PSRAM → OPI PSRAM**.
6. Connect the board by USB-C, pick its port, and click **Upload**.
7. Open the Serial Monitor at 115200 baud. You should see `CashTrack wallet ready`.

### Build and flash with arduino-cli

```bash
arduino-cli core install esp32:esp32@3.0.7 \
  --additional-urls https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli lib install "Adafruit Fingerprint Sensor Library"
arduino-cli compile --fqbn espressif:esp32:XIAO_ESP32S3:PSRAM=opi firmware/wallet
arduino-cli upload  --fqbn espressif:esp32:XIAO_ESP32S3:PSRAM=opi -p /dev/ttyACM0 firmware/wallet
```

### First run

1. With the wallet open and nothing in the pocket mouth, reset the board. It calibrates the IR baseline at start-up.
2. Enrol the owner's finger with the Adafruit library's `enroll` example.
3. Touch the fingerprint sensor. This opens a 60-second pairing window.
4. Pair from the phone and write the 16-byte session key to the key characteristic (`6b1f0003-…`). The wallet stores it, and from then on every event is AES-GCM sealed.
5. Tune `UV_FLUORESCENCE_MIN` in `config.h` with a genuine note and a photocopy.

## 4. Note recognition model

1. Collect images with the camera rig: about 300 images per class, in varied light and with both sides of each note. Use classes `BDT_10` … `BDT_1000`, `USD_1` … `USD_100`, `CNY_1` … `CNY_100`, `no_note` and `other_object`.
2. In Edge Impulse, create an image classification project: 96 × 96 RGB input and MobileNetV2 0.35 transfer learning. Split the test set **by physical note**, not by image.
3. Reach at least 95% accuracy on the held-out set, then deploy as an **Arduino library** named `cashtrack_notes_inferencing` with the int8 (quantised) model.
4. In the Arduino IDE use **Sketch → Include Library → Add .ZIP Library**, then rebuild. `classifier.cpp` detects the library automatically. Without it, the wallet asks the owner to confirm every note.
