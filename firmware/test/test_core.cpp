// Host-side unit tests for the firmware core. Run: make -C firmware/test
#include "../wallet/src/cashtrack_core.h"
#include <stdio.h>
#include <string.h>

using namespace cashtrack;
static int failures = 0, checks = 0;
#define CHECK(cond) do { checks++; if (!(cond)) { failures++; printf("  FAIL %s:%d  %s\n", __FILE__, __LINE__, #cond); } } while (0)
#define TEST(name) static void name(); struct name##_reg { name##_reg() { printf("%s\n", #name); name(); } } name##_inst; static void name()

static Direction run(DirectionDetector& d, const int (*ev)[3], int n) {
  Direction r = Direction::NONE;
  for (int i = 0; i < n; i++) { Direction x = d.feed((uint8_t)ev[i][0], ev[i][1] != 0, (uint32_t)ev[i][2]); if (x != Direction::NONE) r = x; }
  return r;
}

TEST(FT_01_blocked_threshold) {
  CHECK(isBlocked(590, 1000));
  CHECK(!isBlocked(600, 1000));
}

TEST(FT_02_direction_in_out) {
  DirectionDetector d;
  const int in[][3] = {{1, 1, 0}, {2, 1, 240}, {1, 0, 570}, {2, 0, 810}};
  CHECK(run(d, in, 4) == Direction::IN);
  const int out[][3] = {{2, 1, 1000}, {1, 1, 1200}, {2, 0, 1500}, {1, 0, 1700}};
  CHECK(run(d, out, 4) == Direction::OUT);
}

TEST(FT_03_direction_unknown) {
  DirectionDetector d;
  const int back[][3] = {{1, 1, 0}, {2, 1, 200}, {2, 0, 400}, {1, 0, 600}};
  CHECK(run(d, back, 4) == Direction::UNKNOWN);
  const int slow[][3] = {{1, 1, 0}, {2, 1, 1000}, {1, 0, 2000}, {2, 0, 3500}};
  CHECK(run(d, slow, 4) == Direction::UNKNOWN);
  const int one[][3] = {{1, 1, 0}, {1, 0, 300}};
  CHECK(run(d, one, 2) == Direction::UNKNOWN);
}

TEST(FT_04_decision_rule) {
  Prediction ok{true, BDT, 500, 0.97f}, low{true, BDT, 100, 0.62f}, none{false, BDT, 0, 0.9f}, bad{true, BDT, 30, 0.99f};
  CHECK(decide(Direction::IN, ok, true) == Action::COUNT);
  CHECK(decide(Direction::IN, ok, false) == Action::SUSPECT);
  CHECK(decide(Direction::OUT, ok, false) == Action::COUNT);  // UV only checked on the way in
  CHECK(decide(Direction::IN, low, true) == Action::CONFIRM);
  CHECK(decide(Direction::UNKNOWN, ok, true) == Action::CONFIRM);
  CHECK(decide(Direction::IN, none, true) == Action::IGNORE);
  CHECK(decide(Direction::IN, bad, true) == Action::IGNORE);
}

TEST(FT_05_event_json) {
  char buf[96];
  Prediction usd{true, USD, 20, 0.96f};
  CHECK(encodeEvent(buf, sizeof buf, 1044, Direction::IN, Action::COUNT, usd) > 0);
  CHECK(strcmp(buf, "{\"seq\":1044,\"evt\":\"IN\",\"cur\":\"USD\",\"val\":20,\"conf\":0.96}") == 0);
  Prediction fake{true, BDT, 1000, 0.99f};
  encodeEvent(buf, sizeof buf, 1046, Direction::IN, Action::SUSPECT, fake);
  CHECK(strcmp(buf, "{\"seq\":1046,\"evt\":\"SUSPECT\",\"cur\":\"BDT\",\"val\":1000,\"uv\":false}") == 0);
  Prediction low{true, BDT, 100, 0.62f};
  encodeEvent(buf, sizeof buf, 1045, Direction::IN, Action::CONFIRM, low);
  CHECK(strstr(buf, "\"evt\":\"IN?\"") != nullptr);
  char tiny[10];
  CHECK(encodeEvent(tiny, sizeof tiny, 1, Direction::IN, Action::COUNT, usd) == -1);  // never overflows
}

TEST(FT_06_dispense_plan) {
  uint16_t take[4];
  const uint16_t bdt[4] = {2, 4, 5, 10};  // 1000, 500, 200, 100
  CHECK(planWithdrawal(BDT, 1700, bdt, take));
  CHECK(take[0] == 1 && take[1] == 1 && take[2] == 1 && take[3] == 0);
  const uint16_t tricky[4] = {0, 1, 3, 0};
  CHECK(planWithdrawal(BDT, 600, tricky, take));
  CHECK(take[1] == 0 && take[2] == 3);
  const uint16_t only200[4] = {0, 0, 2, 0};
  CHECK(!planWithdrawal(BDT, 300, only200, take));
  const uint16_t cny[4] = {5, 2, 5, 5};
  CHECK(planWithdrawal(CNY, 380, cny, take));
  CHECK(take[0] == 3 && take[1] == 1 && take[2] == 1 && take[3] == 1);
}

int main() {
  printf("\n%d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
