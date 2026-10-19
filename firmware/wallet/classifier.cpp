// AI Vision Camera: camera setup and on-device note classification.
//
// The note model is trained in Edge Impulse (MobileNetV2 0.35, 96×96 RGB, int8) and exported as an
// Arduino library named "cashtrack_notes_inferencing". Class labels use an underscore, e.g. BDT_500,
// USD_20, CNY_100, plus no_note and other_object. See docs/ARCHITECTURE.md → "Training the note model".

#include <Arduino.h>
#include <string.h>
#include <stdlib.h>
#include "esp_camera.h"
#include "camera_pins.h"
#include "classifier.h"

#if __has_include(<cashtrack_notes_inferencing.h>)
#include <cashtrack_notes_inferencing.h>
#define CASHTRACK_HAS_MODEL 1
#else
#define CASHTRACK_HAS_MODEL 0
#endif

using namespace cashtrack;

bool initCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM; c.pin_d1 = Y3_GPIO_NUM; c.pin_d2 = Y4_GPIO_NUM; c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM; c.pin_d5 = Y7_GPIO_NUM; c.pin_d6 = Y8_GPIO_NUM; c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM; c.pin_pclk = PCLK_GPIO_NUM; c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM; c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_RGB565;
  c.frame_size = FRAMESIZE_96X96;  // matches the model input, so no resize is needed
  c.fb_count = 1;
  c.fb_location = CAMERA_FB_IN_PSRAM;
  c.grab_mode = CAMERA_GRAB_LATEST;
  return esp_camera_init(&c) == ESP_OK;
}

// Parses "BDT_500" style labels into a Prediction.
static Prediction fromLabel(const char* label, float conf) {
  Prediction p{false, BDT, 0, conf};
  if (strlen(label) < 5 || label[3] != '_') return p;  // no_note / other_object
  if (strncmp(label, "BDT", 3) == 0) p.cur = BDT;
  else if (strncmp(label, "USD", 3) == 0) p.cur = USD;
  else if (strncmp(label, "CNY", 3) == 0) p.cur = CNY;
  else return p;
  p.value = (uint16_t)atoi(label + 4);
  p.isNote = isValidNote(p.cur, p.value);
  return p;
}

#if CASHTRACK_HAS_MODEL
static camera_fb_t* frame = nullptr;

// Edge Impulse expects each pixel packed as 0xRRGGBB in a float.
static int getPixels(size_t offset, size_t length, float* out) {
  const uint8_t* buf = frame->buf;
  for (size_t i = 0; i < length; i++) {
    size_t px = (offset + i) * 2;
    uint16_t v = (uint16_t)(buf[px] << 8 | buf[px + 1]);  // RGB565, big-endian from the sensor
    uint8_t r = (v >> 8) & 0xF8, g = (v >> 3) & 0xFC, b = (v << 3) & 0xF8;
    out[i] = (float)((r << 16) | (g << 8) | b);
  }
  return 0;
}

Prediction classifyNote() {
  frame = esp_camera_fb_get();
  if (!frame) return Prediction{true, BDT, 100, 0.0f};
  signal_t signal;
  signal.total_length = EI_CLASSIFIER_INPUT_WIDTH * EI_CLASSIFIER_INPUT_HEIGHT;
  signal.get_data = &getPixels;
  ei_impulse_result_t result = {};
  EI_IMPULSE_ERROR err = run_classifier(&signal, &result, false);
  esp_camera_fb_return(frame);
  frame = nullptr;
  if (err != EI_IMPULSE_OK) return Prediction{true, BDT, 100, 0.0f};
  size_t best = 0;
  for (size_t i = 1; i < EI_CLASSIFIER_LABEL_COUNT; i++)
    if (result.classification[i].value > result.classification[best].value) best = i;
  return fromLabel(result.classification[best].label, result.classification[best].value);
}
#else
// No model yet: take a frame so the camera path is exercised, then report zero confidence.
// decide() turns that into CONFIRM, so the app asks the owner which note it was.
Prediction classifyNote() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (fb) esp_camera_fb_return(fb);
  Prediction p = fromLabel("BDT_100", 0.0f);
  return p;
}
#endif
