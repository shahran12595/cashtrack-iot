#pragma once
#include "src/cashtrack_core.h"

// Starts the camera (QVGA, RGB565, in PSRAM).
bool initCamera();

// Captures one frame and classifies it with the note model (20 note classes + no_note + other_object).
// Without the Edge Impulse library installed, returns confidence 0 so every note is confirmed by the user.
cashtrack::Prediction classifyNote();
