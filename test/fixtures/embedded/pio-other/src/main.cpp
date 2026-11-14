#ifdef ARDUINO
#include <Arduino.h>

void setup() { pinMode(LED_BUILTIN, OUTPUT); }
void loop() { digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN)); delay(500); }
#else
// Host (native) build used by `pio test` and `pio run -e native`.
int main() { return 0; }
#endif
