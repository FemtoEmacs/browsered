/*
 * web-hot.c -- the editor's busiest Scheme, compiled
 *
 * At every key the editor colours the visible text (and up to 16 KB
 * before it) and works out the rows of wrapped prose.  Interpreted under
 * Asyncify that took some 130 ms a key in a LaTeX file.  So the procedures
 * that do it -- a language's highlighter, markdown-wrap-end, whatever a user
 * defined in their place -- are compiled by Schemer from their own Scheme
 * source (scheme/extensions/web.scm, hot-of), and run as WebAssembly that
 * reads and writes the editor's memory directly: the text is not copied.
 *
 *   (web-hot-compile source)       start compiling SOURCE, a program whose
 *                                  value is a procedure of three arguments;
 *                                  its number at once (web/schemer.js)
 *   (web-hot-call id a b c)        call it: a string or byte array is
 *                                  passed as its address, a fixnum as itself;
 *                                  its fixnum answer, or -1 not ready yet,
 *                                  -2 failed
 */
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include "llt/llt.h"
#include "flisp.h"

EM_JS(int, web_hot_compile_js, (const char *source), {
	return BrowseredSchemer.hotCompile(UTF8ToString(source));
});
EM_JS(int, web_hot_call_js, (int id, int a, int b, int c), {
	return BrowseredSchemer.hot(id, a, b, c);
});

static value_t web_hot_compile(value_t *a, uint32_t n)
{
	char *source;
	int id;
	argcount("web-hot-compile", n, 1);
	if (!fl_isstring(a[0])) type_error("web-hot-compile", "string", a[0]);
	source = malloc(cvalue_len(a[0]) + 1);
	memcpy(source, cvalue_data(a[0]), cvalue_len(a[0]));
	source[cvalue_len(a[0])] = '\0';
	id = web_hot_compile_js(source);
	free(source);
	return fixnum(id);
}

/* an argument: a fixnum, or the address of a string's or array's bytes */
static int hot_arg(value_t v)
{
	if (isfixnum(v)) return (int) numval(v);
	if (iscvalue(v)) return (int) (intptr_t) cvalue_data(v);
	type_error("web-hot-call", "fixnum, string or array", v);
	return 0;
}

static value_t web_hot_call(value_t *a, uint32_t n)
{
	argcount("web-hot-call", n, 4);
	if (!isfixnum(a[0])) type_error("web-hot-call", "fixnum", a[0]);
	/* no Scheme allocation between taking the addresses and the call */
	return fixnum(web_hot_call_js((int) numval(a[0]), hot_arg(a[1]), hot_arg(a[2]), hot_arg(a[3])));
}

static builtinspec_t hot_builtins[] = {
	{"web-hot-compile", web_hot_compile},
	{"web-hot-call", web_hot_call},
	{NULL, NULL}
};

void web_hot_init(void) { assign_global_builtins(hot_builtins); }
