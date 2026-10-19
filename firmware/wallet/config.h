// Pin map and settings for the CashTrack IoT smart wallet.
// Board: Seeed Studio XIAO ESP32-S3 Sense (camera on the expansion board).
#pragma once

// ---- IR break beams (pulsed IR LEDs, phototransistors on analog pins) ----
#define PIN_IR_LED        1   // D0: drives both IR LEDs through a transistor
#define PIN_IR_RX1        2   // A1: outer beam (beam 1)
#define PIN_IR_RX2        3   // A2: inner beam (beam 2)

// ---- UV counterfeit check ----
#define PIN_UV_LED        4   // D3: 365 nm UV LED
#define PIN_UV_SENSE      5   // A4: phototransistor behind a visible-light filter

// ---- Other sensors and outputs ----
#define PIN_HALL          6   // D5: hall sensor, LOW when the wallet is closed (also the deep-sleep wake pin)
#define PIN_BUZZER        7   // D8: piezo buzzer
#define PIN_ACCEL_INT     9   // D10: accelerometer motion interrupt (pick-up alarm)
#define PIN_FP_TOUCH      8   // D9: fingerprint module touch output
#define PIN_FP_TX        43   // D6: UART to fingerprint module (R503-class)
#define PIN_FP_RX        44   // D7

// ---- Tuning ----
#define BEAM_SAMPLE_US        2000   // read the beams every 2 ms
#define UV_FLUORESCENCE_MIN    180   // ADC counts above dark level that mean "security fibres glow"
#define SLEEP_AFTER_CLOSED_MS 10000  // go to deep sleep 10 s after the wallet closes
#define PAIRING_WINDOW_MS     60000  // the phone may provision a session key for 60 s after a fingerprint match
#define ALARM_GRACE_MS       120000  // no pick-up alarm for 2 minutes after the owner's fingerprint

// ---- BLE ----
#define BLE_NAME            "CashTrack Wallet"
#define SERVICE_UUID        "6b1f0001-4c2a-4f4e-9a8e-5c0a7c1a2b00"
#define EVENT_CHAR_UUID     "6b1f0002-4c2a-4f4e-9a8e-5c0a7c1a2b00"  // notify: encrypted events
#define KEY_CHAR_UUID       "6b1f0003-4c2a-4f4e-9a8e-5c0a7c1a2b00"  // write: 16-byte session key (pairing window only)
