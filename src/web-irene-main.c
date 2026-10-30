/*
 * web-irene-main.c, Browsered: start irene-dixe (compiled as irene_main)
 * with the arguments the page gave its module (see web-main.c).
 */
#include <emscripten.h>
#include <stdlib.h>

extern int irene_main(int, char **);

EM_JS(int, irene_argc, (void), {
	return (Module.arguments || []).length;
});
EM_JS(char *, irene_argv, (int i), {
	var s = Module.arguments[i], n = lengthBytesUTF8(s) + 1, p = _malloc(n);
	stringToUTF8(s, p, n);
	return p;
});

/* after Asyncify, main's return does not reach the page by itself */
EM_JS(void, irene_done, (int code), {
	if (Module.onIreneExit) Module.onIreneExit(code);
});

int main(void)
{
	int n = irene_argc(), i;
	char **argv = calloc((size_t) n + 2, sizeof(char *));
	if (!argv) return 1;
	argv[0] = "irene-dixe";
	for (i = 0; i < n; i++) argv[i + 1] = irene_argv(i);
	n = irene_main(n + 1, argv);
	irene_done(n);
	return n;
}
