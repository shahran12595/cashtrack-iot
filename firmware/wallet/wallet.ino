// CashTrack IoT smart wallet firmware (ESP32-S3).
//
// Flow for every note:
//   hall sensor wakes the chip → IR beams detect a pass and its direction
//   → AI Vision Camera classifies currency + note → UV check (for notes going in)
//   → decide() applies the 3-check rule → event sealed with AES-128-GCM → BLE notify to the phone.
//
// Build: Arduino IDE 2.x or arduino-cli, board "XIAO_ESP32S3", PSRAM "OPI PSRAM".
// Libraries: "Adafruit Fingerprint Sensor Library". Optional: the Edge Impulse export of the note model
// (see classifier.cpp). Without the model the wallet still runs and asks the user to confirm every note.

#include <Arduino.h>
#include <Preferences.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <BLESecurity.h>
#include <Adafruit_Fingerprint.h>
#include "esp_camera.h"
#include "esp_random.h"
#include "esp_sleep.h"
#include "mbedtls/gcm.h"

#include "config.h"
#include "camera_pins.h"
#include "classifier.h"
#include "src/cashtrack_core.h"

using namespace cashtrack;

static DirectionDetector detector;
static Preferences prefs;
static HardwareSerial fpSerial(1);
static Adafruit_Fingerprint finger(&fpSerial);

static BLECharacteristic* eventChar = nullptr;
static volatile bool phoneConnected = false;
static uint8_t sessionKey[16];
static bool haveKey = false;
static uint32_t seq = 0;

static uint16_t baseline[3] = {0, 0, 0};
static bool beamBlocked[3] = {false, false, false};
static bool passActive = false;
static Prediction passPrediction = {false, BDT, 0, 0.0f};
static bool passUv = true;

static uint32_t lastOpenMs = 0, unlockedAtMs = 0, pairingUntilMs = 0;

// ---------------- Buzzer ----------------
static void beep(uint16_t freq, uint16_t ms) { tone(PIN_BUZZER, freq, ms); delay(ms + 20); }
static void beepOk() { beep(1320, 70); beep(1760, 90); }
static void buzzSuspect() { for (int i = 0; i < 3; i++) beep(1900, 160); }

// ---------------- IR beams ----------------
// Pulsed reading: (LED on) − (LED off) rejects sunlight and room light.
static uint16_t readBeam(uint8_t pin) {
  digitalWrite(PIN_IR_LED, HIGH);
  delayMicroseconds(120);
  int on = analogRead(pin);
  digitalWrite(PIN_IR_LED, LOW);
  delayMicroseconds(120);
  int off = analogRead(pin);
  return (uint16_t)max(0, on - off);
}

static void calibrateBeams() {
  uint32_t s1 = 0, s2 = 0;
  for (int i = 0; i < 64; i++) { s1 += readBeam(PIN_IR_RX1); s2 += readBeam(PIN_IR_RX2); delay(2); }
  baseline[1] = s1 / 64;
  baseline[2] = s2 / 64;
  Serial.printf("IR baseline: beam1=%u beam2=%u\n", baseline[1], baseline[2]);
}

// ---------------- UV check ----------------
static bool uvCheck() {
  int dark = analogRead(PIN_UV_SENSE);
  digitalWrite(PIN_UV_LED, HIGH);
  delay(25);
  int lit = analogRead(PIN_UV_SENSE);
  digitalWrite(PIN_UV_LED, LOW);
  return (lit - dark) >= UV_FLUORESCENCE_MIN;
}

// ---------------- AES-GCM sealing ----------------
// Packet = iv(12) | ciphertext | tag(16). The phone opens it with the same session key
// and rejects any seq that is not higher than the last one (core/src/secure.js, EventReceiver.openBytes).
static size_t sealEvent(const char* json, uint8_t* out, size_t cap) {
  size_t n = strlen(json);
  if (!haveKey || cap < n + 28) return 0;
  uint8_t* iv = out;
  esp_fill_random(iv, 12);
  mbedtls_gcm_context gcm;
  mbedtls_gcm_init(&gcm);
  mbedtls_gcm_setkey(&gcm, MBEDTLS_CIPHER_ID_AES, sessionKey, 128);
  int rc = mbedtls_gcm_crypt_and_tag(&gcm, MBEDTLS_GCM_ENCRYPT, n, iv, 12, nullptr, 0,
                                     (const uint8_t*)json, out + 12, 16, out + 12 + n);
  mbedtls_gcm_free(&gcm);
  return rc == 0 ? n + 28 : 0;
}

static void sendEvent(Direction dir, Action action, const Prediction& p) {
  char json[96];
  if (encodeEvent(json, sizeof json, ++seq, dir, action, p) < 0) return;
  prefs.putUInt("seq", seq);  // the counter never goes backwards, even after a reset
  Serial.printf("event %s\n", json);
  uint8_t packet[160];
  size_t len = sealEvent(json, packet, sizeof packet);
  if (len && phoneConnected && eventChar) {
    eventChar->setValue(packet, len);
    eventChar->notify();
  }
  // Not connected: the phone asks for a recount when it reconnects (balance is kept on the phone).
}

// ---------------- BLE ----------------
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { phoneConnected = true; }
  void onDisconnect(BLEServer* s) override { phoneConnected = false; s->startAdvertising(); }
};

class KeyCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    // Only during the pairing window that a fingerprint match opens, and only 16 bytes.
    if (millis() > pairingUntilMs || c->getLength() != 16) { Serial.println("session key refused"); return; }
    memcpy(sessionKey, c->getData(), 16);
    prefs.putBytes("key", sessionKey, 16);
    haveKey = true;
    pairingUntilMs = 0;
    Serial.println("session key stored");
  }
};

static void setupBle() {
  BLEDevice::init(BLE_NAME);
  BLEDevice::setMTU(185);
  // LE Secure Connections with bonding. The wallet has no display, so the BLE link alone is not
  // trusted: every event is additionally sealed with the session key provisioned after a fingerprint.
  BLESecurity* sec = new BLESecurity();
  sec->setAuthenticationMode(ESP_LE_AUTH_REQ_SC_BOND);
  sec->setCapability(ESP_IO_CAP_NONE);
  sec->setInitEncryptionKey(ESP_BLE_ENC_KEY_MASK | ESP_BLE_ID_KEY_MASK);

  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  BLEService* svc = server->createService(SERVICE_UUID);
  eventChar = svc->createCharacteristic(EVENT_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  eventChar->setAccessPermissions(ESP_GATT_PERM_READ_ENCRYPTED);
  eventChar->addDescriptor(new BLE2902());
  BLECharacteristic* keyChar = svc->createCharacteristic(KEY_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE);
  keyChar->setAccessPermissions(ESP_GATT_PERM_WRITE_ENCRYPTED);
  keyChar->setCallbacks(new KeyCallbacks());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  BLEDevice::startAdvertising();
}

// ---------------- Fingerprint ----------------
static bool fingerprintMatched() {
  if (finger.getImage() != FINGERPRINT_OK) return false;
  if (finger.image2Tz() != FINGERPRINT_OK) return false;
  return finger.fingerSearch() == FINGERPRINT_OK;  // the template never leaves the module
}

// ---------------- Note pass handling ----------------
static void onPassStart() {
  passActive = true;
  passPrediction = classifyNote();  // AI Vision Camera, one frame as the note enters the pocket mouth
  passUv = true;
}

static void onPassEnd(Direction dir) {
  passActive = false;
  if (dir == Direction::IN) passUv = uvCheck();
  Action a = decide(dir, passPrediction, passUv);
  if (a == Action::SUSPECT) buzzSuspect();
  else if (a == Action::COUNT) beepOk();
  if (a != Action::IGNORE) sendEvent(dir, a, passPrediction);
}

static void pollBeams() {
  uint32_t now = millis();
  for (uint8_t b = 1; b <= 2; b++) {
    uint16_t level = readBeam(b == 1 ? PIN_IR_RX1 : PIN_IR_RX2);
    bool blocked = isBlocked(level, baseline[b]);
    if (blocked == beamBlocked[b]) continue;
    beamBlocked[b] = blocked;
    if (blocked && !passActive) onPassStart();
    Direction d = detector.feed(b, blocked, now);
    if (d != Direction::NONE) onPassEnd(d);
  }
}

// ---------------- Setup and loop ----------------
void setup() {
  Serial.begin(115200);
  pinMode(PIN_IR_LED, OUTPUT);
  pinMode(PIN_UV_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_HALL, INPUT_PULLUP);
  pinMode(PIN_ACCEL_INT, INPUT);
  pinMode(PIN_FP_TOUCH, INPUT);
  analogReadResolution(12);

  prefs.begin("cashtrack", false);
  seq = prefs.getUInt("seq", 0);
  haveKey = prefs.getBytes("key", sessionKey, 16) == 16;

  fpSerial.begin(57600, SERIAL_8N1, PIN_FP_RX, PIN_FP_TX);
  finger.begin(57600);
  if (!finger.verifyPassword()) Serial.println("fingerprint module not found");

  if (!initCamera()) Serial.println("camera init failed");
  calibrateBeams();
  setupBle();
  lastOpenMs = millis();
  Serial.printf("CashTrack wallet ready, seq=%lu, key=%s\n", (unsigned long)seq, haveKey ? "yes" : "no");
}

void loop() {
  static uint32_t lastSample = 0;
  uint32_t now = millis();
  bool open = digitalRead(PIN_HALL) == HIGH;

  if (digitalRead(PIN_FP_TOUCH) == HIGH && fingerprintMatched()) {
    unlockedAtMs = now;
    pairingUntilMs = now + PAIRING_WINDOW_MS;
    beepOk();
  }

  // Pick-up alarm: movement while closed and not unlocked recently.
  if (!open && digitalRead(PIN_ACCEL_INT) == HIGH && now - unlockedAtMs > ALARM_GRACE_MS) {
    char json[64];
    snprintf(json, sizeof json, "{\"seq\":%lu,\"evt\":\"TAMPER\",\"src\":\"imu\"}", (unsigned long)++seq);
    prefs.putUInt("seq", seq);
    uint8_t packet[96];
    size_t len = sealEvent(json, packet, sizeof packet);
    if (len && phoneConnected) { eventChar->setValue(packet, len); eventChar->notify(); }
    for (int i = 0; i < 6; i++) beep(i % 2 ? 2600 : 2100, 100);
  }

  if (open) {
    lastOpenMs = now;
    if (micros() - lastSample >= BEAM_SAMPLE_US) { lastSample = micros(); pollBeams(); }
  } else if (!passActive && now - lastOpenMs > SLEEP_AFTER_CLOSED_MS && !phoneConnected) {
    // Sleep until the wallet is opened again. RTC GPIO 6 = hall sensor.
    esp_sleep_enable_ext0_wakeup((gpio_num_t)PIN_HALL, 1);
    esp_deep_sleep_start();
  }
}
