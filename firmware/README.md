# Firmware

- `wallet/` is the ESP32-S3 smart wallet sketch. Open `wallet/wallet.ino` in the Arduino IDE.
- `wallet/src/cashtrack_core.*` holds the hardware-independent logic (IR direction, counting rule, event JSON, dispense planner).
- `test/` holds the host unit tests for that core: `make -C firmware/test`.

Wiring, build and flashing steps are in [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md#3-wallet-firmware-xiao-esp32-s3-sense).
