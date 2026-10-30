/*
 * web-scheme.c, Browsered
 *
 * Scheme's door to the page: (web-call NAME ARG) asks the page's
 * Module.browsered.call(NAME, ARG), which may wait (for a file picker, a
 * download, a request to an assistant), and returns its string, or #f.
 * scheme/extensions/web.scm builds the editor's commands on it.
 */
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include "llt/llt.h"
#include "flisp.h"

EM_ASYNC_JS(char *, web_host_call, (const char *name, const char *arg), {
	var r = await Module.browsered.call(UTF8ToString(name), UTF8ToString(arg));
	if (r === null || r === undefined) return 0;
	r = String(r);
	var n = lengthBytesUTF8(r) + 1, p = _malloc(n);
	stringToUTF8(r, p, n);
	return p;
});

static const char *string_arg(value_t v, const char *who)
{
	if (!fl_isstring(v)) type_error((char *) who, "string", v);
	return (const char *) cvalue_data(v);
}

static value_t web_call(value_t *a, uint32_t n)
{
	char *name, *arg, *r;
	value_t v;

	argcount("web-call", n, 2);
	/* copies: the heap may move while the page works */
	name = strdup(string_arg(a[0], "web-call"));
	arg = strdup(string_arg(a[1], "web-call"));
	r = web_host_call(name, arg);
	free(name);
	free(arg);
	if (!r) return FL_F;
	v = string_from_cstr(r);
	free(r);
	return v;
}

/*
 * Schememax's ttfy-request and assistant-request (src/assistant.c), and
 * run-program and spawn-program (src/primitives.c), run programs, which a
 * page cannot.  In the browser the names call Scheme instead (web-...
 * in scheme/extensions/web.scm).  Formerly: ttfy-request and
 * assistant-request run the
 * claude and codex programs, which a page cannot.  In the browser the two
 * names call Scheme instead: web-ttfy-request and web-assistant-request in
 * scheme/extensions/web.scm.  (A builtin cannot be replaced from Scheme
 * with set!, so it is replaced here, before the scripts are loaded.)
 */
static value_t call_scheme(const char *name, value_t *a, uint32_t n)
{
	value_t f = symbol_value(symbol((char *) name));
	if (f == UNBOUND) lerror(UnboundError, "web.scm did not define the browser's TTFY and assistant requests");
	switch (n) {
	case 2: return fl_applyn(2, f, a[0], a[1]);
	case 4: return fl_applyn(4, f, a[0], a[1], a[2], a[3]);
	case 5: return fl_applyn(5, f, a[0], a[1], a[2], a[3], a[4]);
	default: lerror(ArgError, "call_scheme: wrong number of arguments");
	}
	return FL_F;
}
static value_t web_ttfy_request(value_t *a, uint32_t n)
{
	argcount("ttfy-request", n, 4);
	return call_scheme("web-ttfy-request", a, n);
}
static value_t web_assistant_request(value_t *a, uint32_t n)
{
	argcount("assistant-request", n, 2);
	return call_scheme("web-assistant-request", a, n);
}

/* run-program and spawn-program (src/primitives.c) start processes: in the
 * page, irene-dixe runs as a module of its own, and nothing else runs */
static value_t web_run_program(value_t *a, uint32_t n)
{
	argcount("run-program", n, 5);
	return call_scheme("web-run-program", a, n);
}
static value_t web_spawn_program(value_t *a, uint32_t n)
{
	argcount("spawn-program", n, 2);
	return call_scheme("web-spawn-program", a, n);
}

/* A real minibuffer, with path completion supplied by the browser/helper.
 * Commands are not passed through filename expansion or a second parser. */
extern int __real_line_edit(char *, char *, int, int, int (*)(char *, int, int, int));
static char *command_candidates;
static int command_cycle = -1;
static int command_complete(char *buf, int nbuf, int len, int again)
{
    if (!again) command_cycle = -1;
    if (command_cycle < 0) {
        free(command_candidates);
        command_candidates = web_host_call("command-complete",buf);
        if (!command_candidates || !*command_candidates) return len;
        size_t common = strcspn(command_candidates,"\n"); int count = 1;
        for (char *p=strchr(command_candidates,'\n'); p && p[1]; p=strchr(p+1,'\n')) {
            size_t k=0, n=strcspn(p+1,"\n"); count++;
            while (k<common && k<n && command_candidates[k]==p[1+k]) k++;
            common=k;
        }
        if (count==1 || common>(size_t)len) {
            size_t n=common<(size_t)(nbuf-1)?common:(size_t)(nbuf-1);
            memcpy(buf,command_candidates,n); buf[n]=0; return (int)n;
        }
        command_cycle=0;
    }
    char *p=command_candidates;
    for (int i=0;i<command_cycle;i++) {p=strchr(p,'\n'); if (!p || !p[1]) {p=command_candidates;command_cycle=-1;break;} p++;}
    size_t n=strcspn(p,"\n"); if (n>(size_t)(nbuf-1)) n=(size_t)(nbuf-1);
    memcpy(buf,p,n);buf[n]=0;command_cycle++;return (int)n;
}
static value_t web_command_prompt(value_t *a, uint32_t n)
{
    (void)a;
    argcount("web-command-prompt", n, 0);
    char text[4096] = ""; command_cycle=-1;
    int accepted = __real_line_edit("Command: ",text,sizeof(text),0,command_complete);
    free(command_candidates); command_candidates=NULL;
    if (!accepted) return FL_F;
    return string_from_cstr(text);
}
static builtinspec_t web_builtins[] = {
	{"run-program", web_run_program},
	{"spawn-program", web_spawn_program},
	{"web-call", web_call},
	{"web-command-prompt", web_command_prompt},
	{"ttfy-request", web_ttfy_request},
	{"assistant-request", web_assistant_request},
	{NULL, NULL}
};

void web_scheme_init(void) { assign_global_builtins(web_builtins); }
