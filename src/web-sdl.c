/*
 * web-sdl.c, Browsered
 *
 * The SDL2 and SDL_ttf calls of irene-dixe (src/irene-dixe.c, Schememax's
 * plot and table window), drawn on canvases of the page.  irene-dixe is
 * compiled to WebAssembly with this file and the headers in web/sdl/; its
 * own code is unchanged.
 *
 * A window is a canvas in a box over the editor; the software renderer
 * (used to save a picture) is a canvas off the page, read back into the
 * surface's pixels by SDL_RenderPresent.  Text is drawn with the page's
 * fonts.  SDL_WaitEvent waits for the page (Asyncify), as screen_getch
 * does in the editor.
 */

#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include "SDL.h"
#include "SDL_ttf.h"

struct SDL_Window { int id, w, h; };
struct SDL_Renderer { int id; SDL_Window *window; SDL_Surface *target; };
struct SDL_Texture { SDL_Surface *surface; };
struct TTF_Font { int px, style; };

static SDL_PixelFormat argb = { SDL_PIXELFORMAT_ARGB8888 };

/* ------------------------------------------------------------------ */
/* The page's side: Module.sdl, made by web/irene-dixe-pre.js          */
/* ------------------------------------------------------------------ */

EM_JS(int, js_window, (const char *title, int w, int h), {
	return Module.sdl.openWindow(UTF8ToString(title), w, h);
});
EM_JS(void, js_close_window, (int id), { Module.sdl.closeWindow(id); });
EM_JS(int, js_ratio, (void), { return Math.max(1, Math.round(window.devicePixelRatio || 1)); });
EM_JS(int, js_offscreen, (int w, int h), { return Module.sdl.offscreen(w, h); });
EM_JS(void, js_color, (int id, int r, int g, int b, int a), { Module.sdl.color(id, r, g, b, a); });
EM_JS(void, js_clear, (int id), { Module.sdl.clear(id); });
EM_JS(void, js_fill, (int id, int x, int y, int w, int h, int all), {
	Module.sdl.fill(id, x, y, w, h, all);
});
EM_JS(void, js_line, (int id, int x1, int y1, int x2, int y2), {
	Module.sdl.line(id, x1, y1, x2, y2);
});
EM_JS(void, js_clip, (int id, int x, int y, int w, int h, int on), {
	Module.sdl.clip(id, x, y, w, h, on);
});
EM_JS(void, js_text, (int id, const char *s, int px, int bold, int r, int g, int b, int a, int x, int y), {
	Module.sdl.text(id, UTF8ToString(s), px, bold, r, g, b, a, x, y);
});
EM_JS(int, js_text_width, (const char *s, int px, int bold), {
	return Module.sdl.textWidth(UTF8ToString(s), px, bold);
});
EM_JS(void, js_read_pixels, (int id, void *pixels, int w, int h), {
	Module.sdl.readPixels(id, pixels, w, h);
});
EM_JS(void, js_present, (int id), { Module.sdl.present(id); });
/* the next event: fills TYPE (and the key or the wheel) in E; 0 if none */
EM_ASYNC_JS(int, js_wait_event, (void *e, int wait), {
	return await Module.sdl.nextEvent(e, wait);
});

/* ------------------------------------------------------------------ */
/* SDL                                                                 */
/* ------------------------------------------------------------------ */

int SDL_Init(Uint32 flags) { (void) flags; return 0; }
void SDL_Quit(void) { }
const char *SDL_GetError(void) { return "not available in the browser"; }

SDL_Window *SDL_CreateWindow(const char *title, int x, int y, int w, int h, Uint32 flags)
{
	SDL_Window *win = calloc(1, sizeof *win);
	(void) x; (void) y; (void) flags;
	if (!win) return NULL;
	win->w = w;
	win->h = h;
	win->id = js_window(title ? title : "", w, h);
	return win;
}

void SDL_DestroyWindow(SDL_Window *w)
{
	if (!w) return;
	js_close_window(w->id);
	free(w);
}

void SDL_RaiseWindow(SDL_Window *w) { (void) w; }

void SDL_GetWindowSize(SDL_Window *w, int *width, int *height)
{
	if (width) *width = w ? w->w : 0;
	if (height) *height = w ? w->h : 0;
}

SDL_Renderer *SDL_CreateRenderer(SDL_Window *w, int index, Uint32 flags)
{
	SDL_Renderer *r = calloc(1, sizeof *r);
	(void) index; (void) flags;
	if (!r) return NULL;
	r->id = w->id;
	r->window = w;
	return r;
}

SDL_Renderer *SDL_CreateSoftwareRenderer(SDL_Surface *s)
{
	SDL_Renderer *r = calloc(1, sizeof *r);
	if (!r) return NULL;
	r->id = js_offscreen(s->w, s->h);
	r->target = s;
	return r;
}

void SDL_DestroyRenderer(SDL_Renderer *r)
{
	if (r && r->target) js_close_window(r->id);
	free(r);
}

int SDL_GetRendererOutputSize(SDL_Renderer *r, int *w, int *h)
{
	int ratio = r->window ? js_ratio() : 1;
	if (w) *w = r->window ? r->window->w * ratio : r->target->w;
	if (h) *h = r->window ? r->window->h * ratio : r->target->h;
	return 0;
}

int SDL_SetRenderDrawColor(SDL_Renderer *r, Uint8 red, Uint8 green, Uint8 blue, Uint8 alpha)
{
	js_color(r->id, red, green, blue, alpha);
	return 0;
}

int SDL_SetRenderDrawBlendMode(SDL_Renderer *r, SDL_BlendMode mode) { (void) r; (void) mode; return 0; }

int SDL_RenderClear(SDL_Renderer *r) { js_clear(r->id); return 0; }

int SDL_RenderFillRect(SDL_Renderer *r, const SDL_Rect *rect)
{
	if (rect) js_fill(r->id, rect->x, rect->y, rect->w, rect->h, 0);
	else js_fill(r->id, 0, 0, 0, 0, 1);
	return 0;
}

int SDL_RenderDrawLine(SDL_Renderer *r, int x1, int y1, int x2, int y2)
{
	js_line(r->id, x1, y1, x2, y2);
	return 0;
}

int SDL_RenderSetClipRect(SDL_Renderer *r, const SDL_Rect *rect)
{
	if (rect) js_clip(r->id, rect->x, rect->y, rect->w, rect->h, 1);
	else js_clip(r->id, 0, 0, 0, 0, 0);
	return 0;
}

int SDL_RenderCopy(SDL_Renderer *r, SDL_Texture *t, const SDL_Rect *src, const SDL_Rect *dst)
{
	SDL_Surface *s;
	(void) src;
	if (!t || !(s = t->surface) || !s->text || !dst) return -1;
	js_text(r->id, s->text, s->font_px, s->font_bold, s->color.r, s->color.g, s->color.b,
		s->color.a, dst->x, dst->y);
	return 0;
}

void SDL_RenderPresent(SDL_Renderer *r)
{
	if (r->target) js_read_pixels(r->id, r->target->pixels, r->target->w, r->target->h);
	else js_present(r->id);
}

SDL_Surface *SDL_CreateRGBSurfaceWithFormat(Uint32 flags, int w, int h, int depth, Uint32 format)
{
	SDL_Surface *s = calloc(1, sizeof *s);
	(void) flags; (void) depth; (void) format;
	if (!s) return NULL;
	s->w = w;
	s->h = h;
	s->pitch = w * 4;
	s->format = &argb;
	s->pixels = calloc((size_t) w * (size_t) h, 4);
	if (!s->pixels) { free(s); return NULL; }
	return s;
}

void SDL_FreeSurface(SDL_Surface *s)
{
	if (!s) return;
	free(s->pixels);
	free(s->text);
	free(s);
}

SDL_Texture *SDL_CreateTextureFromSurface(SDL_Renderer *r, SDL_Surface *s)
{
	SDL_Texture *t = calloc(1, sizeof *t);
	(void) r;
	if (t) t->surface = s;
	return t;
}

void SDL_DestroyTexture(SDL_Texture *t) { free(t); }

void SDL_GetRGB(Uint32 pixel, const SDL_PixelFormat *format, Uint8 *r, Uint8 *g, Uint8 *b)
{
	(void) format;
	*r = (Uint8) ((pixel >> 16) & 0xFF);
	*g = (Uint8) ((pixel >> 8) & 0xFF);
	*b = (Uint8) (pixel & 0xFF);
}

int SDL_SaveBMP(SDL_Surface *s, const char *file) { (void) s; (void) file; return -1; }

int SDL_WaitEvent(SDL_Event *e) { return js_wait_event(e, 1); }
int SDL_PollEvent(SDL_Event *e) { return js_wait_event(e, 0); }

/* ------------------------------------------------------------------ */
/* SDL_ttf: the page's fonts                                           */
/* ------------------------------------------------------------------ */

int TTF_Init(void) { return 0; }
void TTF_Quit(void) { }
const char *TTF_GetError(void) { return ""; }

TTF_Font *TTF_OpenFont(const char *file, int ptsize)
{
	TTF_Font *f = calloc(1, sizeof *f);
	(void) file;
	if (f) f->px = ptsize;
	return f;
}

void TTF_CloseFont(TTF_Font *f) { free(f); }
void TTF_SetFontStyle(TTF_Font *f, int style) { if (f) f->style = style; }
int TTF_FontLineSkip(const TTF_Font *f) { return (f->px * 5 + 3) / 4; }

int TTF_SizeUTF8(TTF_Font *f, const char *text, int *w, int *h)
{
	if (w) *w = js_text_width(text, f->px, f->style & TTF_STYLE_BOLD);
	if (h) *h = TTF_FontLineSkip(f);
	return 0;
}

SDL_Surface *TTF_RenderUTF8_Blended(TTF_Font *f, const char *text, SDL_Color fg)
{
	SDL_Surface *s = calloc(1, sizeof *s);
	if (!s) return NULL;
	s->text = strdup(text);
	s->font_px = f->px;
	s->font_bold = f->style & TTF_STYLE_BOLD;
	s->color = fg;
	s->w = js_text_width(text, f->px, s->font_bold);
	s->h = TTF_FontLineSkip(f);
	s->format = &argb;
	return s;
}
