/*
 * web-main.c, Browsered
 *
 * The page starts the editor here: Module.arguments (set by the page or
 * a test) become argv, and app.c's main, compiled as app_main, runs.
 */
#include <emscripten.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include "header.h"

extern int app_main(int, char **);

EM_JS(int, web_argc, (void), {
	return (Module.arguments || []).length;
});
EM_JS(char *, web_argv, (int i), {
	var s = Module.arguments[i], n = lengthBytesUTF8(s) + 1, p = _malloc(n);
	stringToUTF8(s, p, n);
	return p;
});

/* C-x C-c: a page cannot close a tab it did not open; it says so */
EM_JS(void, web_ended, (void), { Module.browsered.ended(); });

int main(void)
{
	int n = web_argc(), i;
	char **argv = calloc((size_t) n + 2, sizeof(char *));

	if (!argv) return 1;
	argv[0] = "browsered";
	for (i = 0; i < n; i++) argv[i + 1] = web_argv(i);
	n = app_main(n + 1, argv);
	web_ended();
	return n;
}

/*
 * No processes in a page: the assistants and the shell reach their
 * programs some other way (see README).  posix_spawnp fails like a
 * program that is not installed.
 */
#include <errno.h>
#include <spawn.h>
int posix_spawnp(pid_t *pid, const char *file, const posix_spawn_file_actions_t *fa,
		 const posix_spawnattr_t *attr, char *const argv[], char *const envp[])
{
	(void) pid; (void) file; (void) fa; (void) attr; (void) argv; (void) envp;
	return ENOENT;
}


/* Filename prompts keep Schememax's completion while starting from an
 * editable remembered directory. Only accepted prompts update it. */
EM_JS(char *, web_start_folder, (void), {
    var path = "~/";
    try { path = localStorage.getItem("browsered-last-folder") || path; } catch (_) {}
    var n = lengthBytesUTF8(path) + 1, p = _malloc(n);
    stringToUTF8(path, p, n); return p;
});
EM_JS(void, web_remember_folder, (const char *path), {
    var value = UTF8ToString(path), slash = value.lastIndexOf("/");
    if (slash < 0) return;
    try { localStorage.setItem("browsered-last-folder", value.slice(0, slash + 1)); } catch (_) {}
});
static int filename_prompt = 0;
extern int __real_getfilename(char *, char *, int);
extern int __real_line_edit(char *, char *, int, int, int (*)(char *, int, int, int));
int __wrap_getfilename(char *prompt, char *buf, int nbuf)
{
    int result;
    filename_prompt++;
    result = __real_getfilename(prompt, buf, nbuf);
    filename_prompt--;
    return result;
}
int __wrap_line_edit(char *prompt, char *buf, int nbuf, int flag,
                     int (*complete)(char *, int, int, int))
{
    int result;
    if (filename_prompt && flag == F_CLEAR) {
        char *folder = web_start_folder();
        snprintf(buf, (size_t)nbuf, "%s", folder);
        free(folder);
        flag = F_NONE;
    }
    result = __real_line_edit(prompt, buf, nbuf, flag, complete);
    if (filename_prompt && result) web_remember_folder(buf);
    return result;
}
