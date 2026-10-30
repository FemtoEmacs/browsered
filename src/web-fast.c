/*
 * web-fast.c -- the editor's busiest Scheme, in C, for the browser
 *
 * In the page femtoscheme runs under Asyncify, several times slower than in
 * Schememax.  Two procedures run at every keystroke over the whole visible
 * text: the colours of LaTeX (latex-highlight, scheme/languages/tex.scm,
 * over up to 16 KB before the window as well) and the rows of word-wrapped
 * prose (markdown-wrap-end, scheme/languages/markdown.scm, once per row).
 * Typing in a LaTeX file took some 130 ms a key.  These are the same
 * procedures, byte for byte, in C; scheme/extensions/web.scm puts them in
 * place in the browser only, and tests/fast-test.scm checks that they give
 * exactly what the Scheme ones give.  The Scheme ones stay the reference:
 * change those, then this.
 *
 * The faces (+comment+ ...) and the command lists (*tex-heading-commands*
 * ...) are read from Scheme at each call, so a change made there in
 * init.scm still counts.
 */
#include <stdlib.h>
#include <string.h>
#include "llt/llt.h"
#include "flisp.h"

typedef unsigned char u8;

static long face(const char *name, long fallback)
{
	value_t v = symbol_value(symbol((char *) name));
	return isfixnum(v) ? numval(v) : fallback;
}

/* is the byte string S[0..N) a member of the Scheme list of strings NAME? */
static int member(const u8 *s, size_t n, const char *name)
{
	value_t l = symbol_value(symbol((char *) name));
	for (; iscons(l); l = cdr_(l)) {
		value_t e = car_(l);
		if (fl_isstring(e) && cvalue_len(e) == n && memcmp(cvalue_data(e), s, n) == 0)
			return 1;
	}
	return 0;
}

/* ------------------------------------------------------------------ */
/* latex-highlight                                                     */
/* ------------------------------------------------------------------ */

static struct { long symbol, keyword, alpha, digits, comment, string, heading,
		emphasis, strong, link; } F;

static int letter(int b) { return (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b == 64; }
static int digit(int b) { return b >= 48 && b <= 57; }

static void paint(u8 *c, long from, long to, long f)
{
	for (long i = from; i < to; i++) c[i] = (u8) f;
}

static int match_at(const u8 *t, long len, long i, const char *p)
{
	long n = (long) strlen(p);
	return i + n <= len && memcmp(t + i, p, (size_t) n) == 0;
}

static long command_end(const u8 *t, long i, long len)
{
	if (i + 1 >= len) return len;
	if (letter(t[i + 1])) {
		long j = i + 1;
		while (j < len && letter(t[j])) j++;
		if (j < len && t[j] == 42) return j + 1;     /* \section* */
		return j;
	}
	return i + 2;
}

static long group_end(const u8 *t, long i, long len)
{
	int open = t[i], close = open == 123 ? 125 : 93;
	long j = i + 1, depth = 1;
	for (;;) {
		if (j >= len) return len;
		if (t[j] == 92) { j += 2; continue; }
		if (t[j] == open) { j++; depth++; continue; }
		if (t[j] == close) { if (depth == 1) return j + 1; j++; depth--; continue; }
		j++;
	}
}

static long skip_blanks(const u8 *t, long i, long len)
{
	while (i < len && (t[i] == 32 || t[i] == 9)) i++;
	return i;
}

static long comment_end(const u8 *t, long i, long len)
{
	while (i < len && t[i] != 10) i++;
	return i;
}

static long math_end(const u8 *t, long i, long len, const char *closer)
{
	long j = i;
	for (;;) {
		if (j >= len) return len;
		if (match_at(t, len, j, closer)) return j + (long) strlen(closer);
		if (t[j] == 92) j += 2; else j++;
	}
}

/* the face of the first {argument} of the command T[i..e), or -1 */
static long argument_face(const u8 *t, long i, long e)
{
	size_t n = (size_t) (e - i);
	if (n > 0 && t[e - 1] == 42) n--;                    /* \section* -> \section */
	if (member(t + i, n, "*tex-heading-commands*")) return F.heading;
	if (member(t + i, n, "*tex-emphasis-commands*")) return F.emphasis;
	if (member(t + i, n, "*tex-strong-commands*")) return F.strong;
	if (member(t + i, n, "*tex-link-commands*")) return F.link;
	if ((n == 6 && memcmp(t + i, "\\begin", 6) == 0) || (n == 4 && memcmp(t + i, "\\end", 4) == 0))
		return F.digits;
	return -1;
}

static long paint_argument(const u8 *t, long i, long len, u8 *c, long f)
{
	long j = skip_blanks(t, i, len);
	for (;;) {
		if (j >= len) return j;
		if (t[j] == 91) {
			long e = group_end(t, j, len);
			paint(c, j, e, F.symbol);
			j = skip_blanks(t, e, len);
			continue;
		}
		if (t[j] == 123) {
			long e = group_end(t, j, len);
			c[j] = (u8) F.symbol;
			paint(c, j + 1, e - 1 > j + 1 ? e - 1 : j + 1, f);
			if (e > j + 1) c[e - 1] = (u8) F.symbol;
			return e;
		}
		return j;
	}
}

/* string.find of NEEDLE in T from START, within LEN; -1 if none */
static long search(const u8 *t, long size, const u8 *needle, long n, long start, long len)
{
	for (long k = start; k + n <= size; k++)
		if (memcmp(t + k, needle, (size_t) n) == 0)
			return k + n <= len ? k : -1;
	return -1;
}

static void latex(const u8 *t, long size, long len, u8 *c)
{
	long i = 0;
	while (i < len) {
		int b = t[i];
		if (b == 37) {                                         /* % comment */
			long e = comment_end(t, i, len); paint(c, i, e, F.comment); i = e;
		} else if (match_at(t, len, i, "$$")) {
			long e = math_end(t, i + 2, len, "$$"); paint(c, i, e, F.string); i = e;
		} else if (b == 36) {
			long e = math_end(t, i + 1, len, "$"); paint(c, i, e, F.string); i = e;
		} else if (match_at(t, len, i, "\\[") || match_at(t, len, i, "\\(")) {
			long e = math_end(t, i + 2, len, t[i + 1] == 91 ? "\\]" : "\\)");
			paint(c, i, e, F.string); i = e;
		} else if (b == 92) {                                  /* a command */
			long e = command_end(t, i, len);
			long f = (e - i > 1 && letter(t[i + 1])) ? argument_face(t, i, e) : -1;
			long next = i + 1 < len - 1 ? i + 1 : len - 1;
			paint(c, i, e, letter(t[next]) ? F.keyword : F.symbol);
			if (f < 0) { i = e; continue; }
			if (e - i == 6 && memcmp(t + i, "\\begin", 6) == 0) {
				long a = skip_blanks(t, e, len);
				long after = paint_argument(t, e, len, c, f);
				const u8 *env = (const u8 *) "";
				long envn = 0;
				if (a < len && t[a] == 123) {
					env = t + a + 1;
					envn = (after - 1 > a + 1 ? after - 1 : a + 1) - (a + 1);
				}
				if (member(env, (size_t) envn, "*tex-math-environments*")) {
					/* the body of a math environment, up to its \end */
					u8 *needle = malloc((size_t) envn + 7);
					long close, stop;
					memcpy(needle, "\\end{", 5);
					memcpy(needle + 5, env, (size_t) envn);
					needle[5 + envn] = '}';
					close = search(t, size, needle, envn + 6, after, len);
					free(needle);
					stop = close >= 0 ? close : len;
					paint(c, after, stop, F.string);
					i = stop;
				} else {
					i = after;
				}
			} else {
				i = paint_argument(t, e, len, c, f);
			}
		} else if (digit(b)) {
			c[i++] = (u8) F.digits;
		} else if (b == 123 || b == 125 || b == 91 || b == 93 || b == 38 || b == 94 || b == 95 || b == 126) {
			c[i++] = (u8) F.symbol;
		} else {
			c[i++] = (u8) ((b == 32 || b == 9 || b == 10 || b == 13) ? F.symbol : F.alpha);
		}
	}
}

/* (web-latex-highlight lang text len colors): latex-highlight in C */
static value_t web_latex_highlight(value_t *a, uint32_t n)
{
	long size, len;
	argcount("web-latex-highlight", n, 4);
	if (!fl_isstring(a[1])) type_error("web-latex-highlight", "string", a[1]);
	if (!isfixnum(a[2])) type_error("web-latex-highlight", "fixnum", a[2]);
	if (!iscvalue(a[3])) type_error("web-latex-highlight", "array", a[3]);
	F.symbol = face("+symbol+", 1);   F.keyword = face("+keyword+", 4);
	F.alpha = face("+alpha+", 5);     F.digits = face("+digits+", 6);
	F.comment = face("+comment+", 7); F.string = face("+string+", 9);
	F.heading = face("+heading+", 11); F.emphasis = face("+emphasis+", 12);
	F.strong = face("+strong+", 13);  F.link = face("+link+", 14);
	size = (long) cvalue_len(a[1]);
	len = numval(a[2]);
	if (len > size) len = size;
	if (len > (long) cvalue_len(a[3])) len = (long) cvalue_len(a[3]);
	if (len > 0) latex((const u8 *) cvalue_data(a[1]), size, len, (u8 *) cvalue_data(a[3]));
	return FL_T;
}

/* ------------------------------------------------------------------ */
/* markdown-wrap-end                                                   */
/* ------------------------------------------------------------------ */

static long hang_blanks(const u8 *t, long pos, long size)
{
	for (;;) {
		if (pos >= size) return pos;
		if (t[pos] == 9 || t[pos] == 32) { pos++; continue; }
		if (t[pos] == 10) return pos + 1;
		if (t[pos] == 13 && pos + 1 < size && t[pos + 1] == 10) return pos + 2;
		return pos;
	}
}

/* (web-wrap-end text columns): markdown-wrap-end in C */
static value_t web_wrap_end(value_t *a, uint32_t n)
{
	const u8 *t;
	long size, columns, pos = 0, column = 0, boundary = -1;
	argcount("web-wrap-end", n, 2);
	if (!fl_isstring(a[0])) type_error("web-wrap-end", "string", a[0]);
	if (!isfixnum(a[1])) type_error("web-wrap-end", "fixnum", a[1]);
	t = (const u8 *) cvalue_data(a[0]);
	size = (long) cvalue_len(a[0]);
	columns = numval(a[1]);
	for (;;) {
		int b, bytes, width;
		if (pos >= size) return fixnum(pos);
		b = t[pos];
		bytes = (b >= 0xC2 && b <= 0xDF) ? 2 : (b >= 0xE0 && b <= 0xEF) ? 3 : (b >= 0xF0 && b <= 0xF4) ? 4 : 1;
		width = b == 13 ? 0 : b == 9 ? 8 - (int) (column % 8) : (b < 32 || b == 127) ? 2 : 1;
		if (b == 10) return fixnum(pos + 1);
		if (column + width > columns) {
			if (pos > 0 && (b == 9 || b == 32)) return fixnum(hang_blanks(t, pos, size));
			if (boundary >= 0) return fixnum(boundary);
			return fixnum(pos > 0 ? pos : (size < bytes ? size : bytes));
		}
		{
			long next = pos + (bytes < size - pos ? bytes : size - pos);
			column += width;
			if (b == 9 || b == 32) boundary = next;
			pos = next;
		}
	}
}

static builtinspec_t fast_builtins[] = {
	{"web-latex-highlight", web_latex_highlight},
	{"web-wrap-end", web_wrap_end},
	{NULL, NULL}
};

void web_fast_init(void) { assign_global_builtins(fast_builtins); }
