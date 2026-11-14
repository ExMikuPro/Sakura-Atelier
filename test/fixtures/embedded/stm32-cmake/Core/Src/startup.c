extern int main(void);
extern unsigned int _estack;

void Reset_Handler(void) { main(); for (;;) { } }

__attribute__((section(".isr_vector"), used))
void (*const vector_table[])(void) = { (void (*)(void))&_estack, Reset_Handler };
