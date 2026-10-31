/*
 * web-layer.c -- the text that Grammarly sees
 *
 * Grammarly (and any browser writing tool) reads only text fields of the
 * page, never the canvas the editor paints.  So after every redisplay the
 * page is told what the selected window shows when it holds prose (a file
 * that word-wraps: Markdown, TeX, text): its rows on the screen and the
 * buffer's text from the window's first character to its last.  The page
 * lays a transparent text field with that text exactly over those rows
 * (web/browsered.js, textLayer); Grammarly underlines it there, and a
 * correction comes back as (web-layer-edit ...) of scheme/extensions/web.scm.
 * The editor stays the only editor: the field never edits the buffer itself.
 *
 * The field is there only while the user asks for the check ([GRAMMAR] or
 * C-c d, toggle-grammarly in web.scm), and only for the buffer it was
 * asked in: Grammarly never nags while one simply writes, and the field
 * goes away when the check ends or the window shows another buffer.
 *
 * This file reads the C core's windows; it changes nothing in them.
 */
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include "header.h"

extern int web_wraps(const char *key);   /* web-scheme.c: markdown-wrap-row */
static int enabled = 0;                  /* checking, in ... */
static buffer_t *checked = NULL;         /* ... this buffer */

/* (web-text-layer #t): check the selected window's buffer; #f: stop */
int web_layer_set(int on)
{
	enabled = on && curwp != NULL && curwp->w_bufp != NULL;
	checked = enabled ? curwp->w_bufp : NULL;
	return enabled;
}
int web_layer_on(void) { return enabled; }

EM_JS(void, web_layer, (const char *json), {
	Module.browsered.textLayer(json ? UTF8ToString(json) : null);
});

static char *out = NULL;
static size_t cap = 0, len = 0;

static void put(const char *s, size_t n)
{
	if (len + n + 1 > cap) {
		size_t c = cap ? cap : 4096;
		while (len + n + 1 > c) c *= 2;
		char *grown = realloc(out, c);
		if (grown == NULL) return;
		out = grown;
		cap = c;
	}
	memcpy(out + len, s, n);
	len += n;
	out[len] = '\0';
}

static void puts_(const char *s) { put(s, strlen(s)); }

static void putnum(const char *name, long v)
{
	char b[48];
	snprintf(b, sizeof b, "\"%s\":%ld,", name, v);
	puts_(b);
}

static void putbyte(unsigned char c)
{
	char b[8];
	if (c == '"' || c == '\\') { b[0] = '\\'; b[1] = (char) c; put(b, 2); }
	else if (c == '\n') put("\\n", 2);
	else if (c == '\t') put("\\t", 2);
	else if (c < 0x20 || c == 0x7f) { snprintf(b, sizeof b, "\\u%04x", c); put(b, 6); }
	else put((const char *) &c, 1);
}

void web_layer_update(void)
{
	window_t *wp = curwp;
	buffer_t *bp;
	const char *key;
	point_t from, to, at, i, size;

	if (enabled && (wp == NULL || wp->w_bufp != checked)) web_layer_set(0);   /* another buffer: done */
	if (!enabled || wp == NULL || (bp = wp->w_bufp) == NULL) { web_layer(NULL); return; }
	key = bp->b_fname[0] ? bp->b_fname : bp->b_bname;
	if (!web_wraps(key)) { web_layer(NULL); return; }
	size = document_size(bp);
	from = wp->w_page < 0 ? 0 : (wp->w_page > size ? size : wp->w_page);
	to = wp->w_epage < from ? from : (wp->w_epage > size ? size : wp->w_epage);
	at = wp->w_point < from ? from : (wp->w_point > to ? to : wp->w_point);
	len = 0;
	puts_("{");
	putnum("top", wp->w_top);
	putnum("rows", wp->w_rows);
	putnum("page", (long) from);
	putnum("point", (long) (at - from));
	puts_("\"buffer\":\"");
	for (i = 0; bp->b_bname[i]; i++) putbyte((unsigned char) bp->b_bname[i]);
	puts_("\",\"text\":\"");
	for (i = from; i < to; i++) putbyte(*ptr(bp, i));
	puts_("\"}");
	web_layer(out);
}

/*
 * The page changed size, or Scheme from the page ran: redraw the windows.
 * The core's own answer to a resize (resize_terminal, Femto's) is a single
 * window, which lost the windows of C-x 2 whenever the browser window
 * changed size.  Here the windows keep their share of the screen; only if
 * the page becomes too short for them all do the last ones go (never the
 * selected one).  ROWS: the new height of the grid.
 */
void web_relayout(int rows)
{
	window_t *wp;
	int old = 0, avail = rows - 1, n = 0, top = 0, left, k = 0;

	if (wheadp == NULL || curwp == NULL) return;
	for (wp = wheadp; wp != NULL; wp = wp->w_next) { old += wp->w_rows + 1; n++; }
	/* each window needs a text row and its mode line */
	while (n > 1 && avail < 2 * n) {
		window_t *last = NULL, *prev = NULL;
		for (wp = wheadp; wp != NULL; wp = wp->w_next)
			if (wp != curwp) { last = wp; }
		for (wp = wheadp; wp != NULL && wp->w_next != last; wp = wp->w_next) ;
		prev = (last == wheadp) ? NULL : wp;
		if (last == NULL) break;
		if (prev) prev->w_next = last->w_next; else wheadp = last->w_next;
		old -= last->w_rows + 1;
		n--;
	}
	if (old <= 0) old = 1;
	left = avail;
	for (wp = wheadp; wp != NULL; wp = wp->w_next, k++) {
		int share = wp->w_next == NULL ? left : (int) ((long) (wp->w_rows + 1) * avail / old);
		if (share < 2) share = 2;
		if (share > left - 2 * (n - k - 1)) share = left - 2 * (n - k - 1);
		/* fewer rows: the old end of the window no longer shows, so the
		 * display finds the cursor's row again (display.c reframes) */
		if (share - 1 < wp->w_rows) {
			wp->w_epage = wp->w_page;
			/* the selected window's live values are its buffer's */
			if (wp == curwp) wp->w_bufp->b_epage = wp->w_bufp->b_page;
		}
		wp->w_top = top;
		wp->w_rows = share - 1;
		wp->w_update = TRUE;
		top += share;
		left -= share;
	}
}

/* everything drawn again (the core's update after a command) */
void web_redisplay(void)
{
	if (wheadp == NULL || curwp == NULL) return;
	mark_all_windows();
	update_display();
}
