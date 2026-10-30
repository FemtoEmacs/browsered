/*
 * primitives.c -- what the Scheme scripts need beyond the fe_* editor API
 *
 * Buffer text in bulk (as strings of raw UTF-8 bytes: femtoscheme strings
 * are byte arrays, so AREF reads a byte), exact byte insertion for undo,
 * the C core's command and hint tables, the mouse, files, and running a
 * program with a timeout.  Errors are reported with lerror, which the
 * callers in hooks.c turn into messages: nothing here exits.
 */
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include "llt/llt.h"
#include "flisp.h"

extern long fe_buffer_size(void);
extern long fe_copy_text(long start, long len, char *out);
extern void fe_insert_bytes(long p, char *bytes, long len);
extern void fe_add_command_name(char *name);
extern void fe_set_buffer_hint(char *name, char *hint);
extern void fe_set_modeline_hints(char *help, char *tail);
extern void editor_mouse_event(void);
extern int fe_buffer_read_only(void);
extern void fe_set_read_only(int on);
extern int getcommand(char *, int);

static value_t bytes_string(const char *data, size_t len)
{
	value_t s = cvalue_string(len);
	if (len) memcpy(cvalue_data(s), data, len);
	return s;
}

/* (buffer-substring start end): the bytes of the current buffer */
static value_t buffer_substring(value_t *a, uint32_t n)
{
	argcount("buffer-substring", n, 2);
	long size = fe_buffer_size();
	long start = tofixnum(a[0], "buffer-substring");
	long end = tofixnum(a[1], "buffer-substring");
	if (start < 0) start = 0;
	if (end > size) end = size;
	if (end <= start) return bytes_string("", 0);
	value_t s = cvalue_string((size_t) (end - start));
	fe_copy_text(start, end - start, (char *) cvalue_data(s));
	return s;
}

/* (fe-insert-bytes pos string): exactly these bytes, NULs included */
static value_t insert_bytes(value_t *a, uint32_t n)
{
	argcount("fe-insert-bytes", n, 2);
	long p = tofixnum(a[0], "fe-insert-bytes");
	if (!fl_isstring(a[1])) lerror(ArgError, "fe-insert-bytes: expected a string");
	fe_insert_bytes(p, (char *) cvalue_data(a[1]), (long) cvalue_len(a[1]));
	return FL_T;
}

static value_t add_command_name(value_t *a, uint32_t n)
{
	argcount("fe-add-command-name", n, 1);
	fe_add_command_name(tostring(a[0], "fe-add-command-name"));
	return FL_T;
}

static value_t set_buffer_hint(value_t *a, uint32_t n)
{
	argcount("fe-set-buffer-hint", n, 2);
	fe_set_buffer_hint(tostring(a[0], "fe-set-buffer-hint"), tostring(a[1], "fe-set-buffer-hint"));
	return FL_T;
}

static value_t set_modeline_hints(value_t *a, uint32_t n)
{
	argcount("fe-set-modeline-hints", n, 2);
	fe_set_modeline_hints(tostring(a[0], "fe-set-modeline-hints"),
			      tostring(a[1], "fe-set-modeline-hints"));
	return FL_T;
}

/* the mouse event GET-KEY just read (a menu reading keys passes it on) */
static value_t mouse_event(value_t *a, uint32_t n)
{
	(void) a;
	argcount("fe-mouse-event", n, 0);
	editor_mouse_event();
	return FL_T;
}

/* (file-attributes path): #f, or (directory? size mtime) */
static value_t file_info(value_t *a, uint32_t n)
{
	argcount("file-attributes", n, 1);
	struct stat st;
	if (stat(tostring(a[0], "file-attributes"), &st) != 0) return FL_F;
	/* times past 2^29 seconds do not fit a fixnum in 32-bit WebAssembly */
	value_t size = return_from_int64((int64_t) st.st_size), when = return_from_int64((int64_t) st.st_mtime);
	return fl_cons(S_ISDIR(st.st_mode) ? FL_T : FL_F, fl_list2(size, when));
}

static value_t file_executable(value_t *a, uint32_t n)
{
	argcount("file-executable?", n, 1);
	struct stat st;
	const char *p = tostring(a[0], "file-executable?");
	return (stat(p, &st) == 0 && S_ISREG(st.st_mode) && access(p, X_OK) == 0) ? FL_T : FL_F;
}

static value_t real_path(value_t *a, uint32_t n)
{
	argcount("real-path", n, 1);
	char out[PATH_MAX];
	if (!realpath(tostring(a[0], "real-path"), out)) return FL_F;
	return bytes_string(out, strlen(out));
}

/* (format-time seconds): local "YYYY-MM-DD HH:MM" */
static value_t format_time(value_t *a, uint32_t n)
{
	argcount("format-time", n, 1);
	/* Browser Wasm uses 29-bit fixnums; ordinary Unix timestamps are
	 * boxed int32/int64 values returned by file-attributes. */
	int64_t seconds;
	if (isfixnum(a[0])) seconds = (int64_t) numval(a[0]);
	else if (iscprim(a[0]) && cp_numtype((cprim_t *)ptr(a[0])) < T_FLOAT) {
		cprim_t *number = (cprim_t *)ptr(a[0]);
		if (cp_numtype(number) == T_UINT64 &&
		    conv_to_uint64(cp_data(number), T_UINT64) > INT64_MAX)
			lerror(ArgError, "format-time: timestamp out of range");
		seconds = conv_to_int64(cp_data(number), cp_numtype(number));
	} else {
		type_error("format-time", "integer", a[0]);
		return FL_F;
	}
	time_t t = (time_t) seconds;
	struct tm tm;
	char out[32];
	if ((int64_t)t != seconds) {
		/* A 32-bit time_t (Emscripten 3.1.6) ends in January 2038: take
		 * the local offset at the nearest time it holds, and work out the
		 * date by hand (days to civil date, as in Howard Hinnant's
		 * date algorithms). */
		time_t probe = seconds > 0 ? (time_t) 2147000000 : (time_t) -2147000000;
		int64_t local, days, rest, z, era, doe, yoe, y, doy, mp, d, m;
		if (!localtime_r(&probe, &tm)) lerror(ArgError, "format-time: timestamp out of range");
		local = seconds + ((int64_t) timegm(&tm) - (int64_t) probe);
		days = local / 86400; rest = local % 86400;
		if (rest < 0) { rest += 86400; days--; }
		z = days + 719468;
		era = (z >= 0 ? z : z - 146096) / 146097;
		doe = z - era * 146097;
		yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
		y = yoe + era * 400;
		doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
		mp = (5 * doy + 2) / 153;
		d = doy - (153 * mp + 2) / 5 + 1;
		m = mp < 10 ? mp + 3 : mp - 9;
		if (m <= 2) y++;
		snprintf(out, sizeof(out), "%04lld-%02lld-%02lld %02lld:%02lld", (long long) y, (long long) m,
			 (long long) d, (long long) (rest / 3600), (long long) (rest % 3600 / 60));
		return bytes_string(out, strlen(out));
	}
	if (!localtime_r(&t, &tm) || !strftime(out, sizeof(out), "%Y-%m-%d %H:%M", &tm))
		lerror(ArgError, "format-time: timestamp out of range");
	return bytes_string(out, strlen(out));
}

static value_t delete_file(value_t *a, uint32_t n)
{
	argcount("delete-file", n, 1);
	return unlink(tostring(a[0], "delete-file")) == 0 ? FL_T : FL_F;
}

/* read a whole file into a string of bytes, or #f */
static value_t read_file_bytes(const char *path)
{
	FILE *f = fopen(path, "rb");
	if (!f) return FL_F;
	fseek(f, 0, SEEK_END);
	long size = ftell(f);
	rewind(f);
	if (size < 0 || size > 64L * 1024 * 1024) { fclose(f); return FL_F; }
	value_t s = cvalue_string((size_t) size);
	size_t got = fread(cvalue_data(s), 1, (size_t) size, f);
	fclose(f);
	if ((long) got != size) return FL_F;
	return s;
}

static value_t file_contents(value_t *a, uint32_t n)
{
	argcount("file-contents", n, 1);
	return read_file_bytes(tostring(a[0], "file-contents"));
}

/*
 * (run-program program args input timeout directory)
 *
 * Run PROGRAM (looked up on the PATH when it has no slash) with the list of
 * strings ARGS, INPUT (a string, or #f for none) on its standard input, in
 * DIRECTORY (#f: here).  Its output and errors go to temporary files, so a
 * big output cannot deadlock it.  After TIMEOUT seconds it is killed.
 * Returns (stdout stderr status); status is -1 when it could not run or was
 * killed (stderr then says why).
 */
#define MAX_ARGS 256

static value_t run_program(value_t *a, uint32_t n)
{
	argcount("run-program", n, 5);
	const char *program = tostring(a[0], "run-program");
	char *argv[MAX_ARGS + 2];
	int argc = 0;
	value_t l = a[1];
	argv[argc++] = (char *) program;
	while (iscons(l)) {
		if (argc >= MAX_ARGS) lerror(ArgError, "run-program: too many arguments");
		argv[argc++] = tostring(car_(l), "run-program");
		l = cdr_(l);
	}
	argv[argc] = NULL;
	long timeout = tofixnum(a[3], "run-program");
	const char *dir = a[4] == FL_F ? NULL : tostring(a[4], "run-program");

	char tmpl[] = "/tmp/schememax-run-XXXXXX";
	char *tmp = mkdtemp(tmpl);
	if (!tmp) lerror(IOError, "run-program: cannot create a temporary folder");
	char in[300], out[300], err[300];
	snprintf(in, sizeof(in), "%s/in", tmp);
	snprintf(out, sizeof(out), "%s/out", tmp);
	snprintf(err, sizeof(err), "%s/err", tmp);
	FILE *f = fopen(in, "wb");
	if (f) {
		if (a[2] != FL_F && fl_isstring(a[2]))
			fwrite(cvalue_data(a[2]), 1, cvalue_len(a[2]), f);
		fclose(f);
	}

	int status = 0, done = 0, killed = 0;
	pid_t pid = fork();
	if (pid == 0) {
		int fi = open(in, O_RDONLY), fo = open(out, O_WRONLY | O_CREAT | O_TRUNC, 0600),
		    fe = open(err, O_WRONLY | O_CREAT | O_TRUNC, 0600);
		if (fi < 0 || fo < 0 || fe < 0) _exit(126);
		dup2(fi, 0); dup2(fo, 1); dup2(fe, 2);
		close(fi); close(fo); close(fe);
		if (dir && chdir(dir) != 0) {
			fprintf(stderr, "cannot enter %s: %s\n", dir, strerror(errno));
			_exit(126);
		}
		execvp(program, argv);
		fprintf(stderr, "%s: %s\n", program, strerror(errno));
		_exit(127);
	}
	if (pid > 0) {
		struct timespec tick = { 0, 20 * 1000 * 1000 };
		long ticks = timeout * 50;
		for (long i = 0; i <= ticks; i++) {
			pid_t w = waitpid(pid, &status, WNOHANG);
			if (w == pid) { done = 1; break; }
			if (w < 0 && errno != EINTR) break;
			nanosleep(&tick, NULL);
		}
		if (!done) {
			kill(pid, SIGTERM);
			nanosleep(&tick, NULL);
			if (waitpid(pid, &status, WNOHANG) != pid) {
				kill(pid, SIGKILL);
				waitpid(pid, &status, 0);
			}
			killed = 1;
		}
	}
	value_t so = FL_NIL, se = FL_NIL, result = FL_NIL;
	fl_gc_handle(&so); fl_gc_handle(&se); fl_gc_handle(&result);
	so = read_file_bytes(out);
	if (so == FL_F) so = bytes_string("", 0);
	if (pid < 0) {
		const char *why = strerror(errno);
		se = bytes_string(why, strlen(why));
	} else if (killed) {
		char why[80];
		snprintf(why, sizeof(why), "no answer after %ld seconds", timeout);
		se = bytes_string(why, strlen(why));
	} else {
		se = read_file_bytes(err);
		if (se == FL_F) se = bytes_string("", 0);
	}
	fixnum_t code = (pid < 0 || killed) ? -1 :
		WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
	result = fl_cons(so, fl_list2(se, fixnum(code)));
	fl_free_gc_handles(3);
	unlink(in); unlink(out); unlink(err); rmdir(tmp);
	return result;
}

/*
 * (spawn-program program args): start PROGRAM with the list of strings ARGS
 * and do not wait for it (a viewer window, say).  It runs in a session of
 * its own, with no terminal, so it survives the editor and never draws on
 * its screen.  #t when it started, otherwise a string saying why not.
 * A double fork leaves no zombie; a close-on-exec pipe reports exec errors.
 */
static value_t spawn_program(value_t *a, uint32_t n)
{
	argcount("spawn-program", n, 2);
	const char *program = tostring(a[0], "spawn-program");
	char *argv[MAX_ARGS + 2];
	int argc = 0, fds[2];
	value_t l = a[1];
	argv[argc++] = (char *) program;
	while (iscons(l)) {
		if (argc >= MAX_ARGS) lerror(ArgError, "spawn-program: too many arguments");
		argv[argc++] = tostring(car_(l), "spawn-program");
		l = cdr_(l);
	}
	argv[argc] = NULL;
	if (pipe(fds) != 0) lerror(IOError, "spawn-program: pipe failed");
	fcntl(fds[1], F_SETFD, FD_CLOEXEC);
	pid_t pid = fork();
	if (pid < 0) {
		close(fds[0]); close(fds[1]);
		lerror(IOError, "spawn-program: fork failed");
	}
	if (pid == 0) {
		close(fds[0]);
		setsid();
		if (fork() != 0) _exit(0);
		int null = open("/dev/null", O_RDWR);
		if (null >= 0) { dup2(null, 0); dup2(null, 1); dup2(null, 2); if (null > 2) close(null); }
		execv(program, argv);
		int e = errno;
		if (write(fds[1], &e, sizeof(e)) < 0) { /* nothing more to say */ }
		_exit(127);
	}
	close(fds[1]);
	int status, err = 0;
	waitpid(pid, &status, 0);
	ssize_t got = read(fds[0], &err, sizeof(err));
	close(fds[0]);
	if (got == (ssize_t) sizeof(err)) {
		const char *why = strerror(err);
		return bytes_string(why, strlen(why));
	}
	return FL_T;
}

/* (buffer-read-only?) and (set-buffer-read-only! flag): the current buffer */
static value_t buffer_read_only(value_t *a, uint32_t n)
{
	(void) a;
	argcount("buffer-read-only?", n, 0);
	return fe_buffer_read_only() ? FL_T : FL_F;
}

static value_t set_buffer_read_only(value_t *a, uint32_t n)
{
	argcount("set-buffer-read-only!", n, 1);
	fe_set_read_only(a[0] != FL_F);
	return a[0] != FL_F ? FL_T : FL_F;
}

/* (os-name): "darwin", "linux", ... (uname, lower case) */
static value_t os_name(value_t *a, uint32_t n)
{
	(void) a;
	argcount("os-name", n, 0);
	struct utsname u;
	char name[sizeof(u.sysname)];
	size_t i;
	if (uname(&u) != 0) return bytes_string("unknown", 7);
	for (i = 0; u.sysname[i] && i + 1 < sizeof(name); i++)
		name[i] = (char) ((u.sysname[i] >= 'A' && u.sysname[i] <= 'Z') ? u.sysname[i] + 32 : u.sysname[i]);
	name[i] = '\0';
	return bytes_string(name, strlen(name));
}

/* (getpid): this process's id, to name temporary files */
static value_t get_pid(value_t *a, uint32_t n)
{
	(void) a;
	argcount("getpid", n, 0);
	return fixnum((fixnum_t) getpid());
}

static value_t command_prompt(value_t *a, uint32_t n)
{
    (void)a; argcount("command-prompt", n, 0);
    char command[4096] = "";
    if (!getcommand(command, sizeof(command))) return FL_F;
    return bytes_string(command, strlen(command));
}

void primitives_init(void)
{
	static builtinspec_t functions[] = {
		{ "buffer-substring", buffer_substring },
        { "command-prompt", command_prompt },
		{ "fe-insert-bytes", insert_bytes },
		{ "fe-add-command-name", add_command_name },
		{ "fe-set-buffer-hint", set_buffer_hint },
		{ "fe-set-modeline-hints", set_modeline_hints },
		{ "fe-mouse-event", mouse_event },
		{ "file-attributes", file_info },
		{ "file-executable?", file_executable },
		{ "real-path", real_path },
		{ "format-time", format_time },
		{ "delete-file", delete_file },
		{ "file-contents", file_contents },
		{ "run-program", run_program },
		{ "spawn-program", spawn_program },
		{ "os-name", os_name },
		{ "buffer-read-only?", buffer_read_only },
		{ "set-buffer-read-only!", set_buffer_read_only },
		{ "getpid", get_pid },
		{ NULL, NULL }
	};
	assign_global_builtins(functions);
}
