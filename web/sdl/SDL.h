/*
 * SDL.h, Browsered: the part of SDL2 that irene-dixe uses, for the
 * browser.  src/web-sdl.c draws it on a canvas of the page.  Only the
 * WebAssembly build of irene-dixe sees this header; Schememax's own
 * builds use the real SDL2.
 */
#ifndef BROWSERED_SDL_H
#define BROWSERED_SDL_H

#include <stdint.h>

typedef uint8_t Uint8;
typedef uint32_t Uint32;
typedef int32_t Sint32;
typedef int32_t SDL_Keycode;

typedef struct { int x, y, w, h; } SDL_Rect;
typedef struct { Uint8 r, g, b, a; } SDL_Color;
typedef struct { Uint32 format; } SDL_PixelFormat;

typedef struct SDL_Surface {
	int w, h, pitch;
	void *pixels;
	SDL_PixelFormat *format;
	/* a surface made by TTF_RenderUTF8_Blended holds its text, not pixels */
	char *text;
	int font_px, font_bold;
	SDL_Color color;
} SDL_Surface;

typedef struct SDL_Window SDL_Window;
typedef struct SDL_Renderer SDL_Renderer;
typedef struct SDL_Texture SDL_Texture;

typedef struct { SDL_Keycode sym; } SDL_Keysym;
typedef struct { Uint32 type; SDL_Keysym keysym; } SDL_KeyboardEvent;
typedef struct { Uint32 type; Sint32 x, y; } SDL_MouseWheelEvent;
typedef union {
	Uint32 type;
	SDL_KeyboardEvent key;
	SDL_MouseWheelEvent wheel;
	Uint8 padding[56];
} SDL_Event;

enum { SDL_QUIT = 0x100, SDL_KEYDOWN = 0x300, SDL_MOUSEWHEEL = 0x403 };

#define SDLK_SCANCODE(x) ((x) | (1 << 30))
enum {
	SDLK_ESCAPE = 27, SDLK_SPACE = ' ', SDLK_q = 'q', SDLK_s = 's',
	SDLK_RIGHT = SDLK_SCANCODE(79), SDLK_LEFT = SDLK_SCANCODE(80),
	SDLK_DOWN = SDLK_SCANCODE(81), SDLK_UP = SDLK_SCANCODE(82),
	SDLK_HOME = SDLK_SCANCODE(74), SDLK_PAGEUP = SDLK_SCANCODE(75),
	SDLK_END = SDLK_SCANCODE(77), SDLK_PAGEDOWN = SDLK_SCANCODE(78)
};

#define SDL_INIT_VIDEO 0x20
#define SDL_WINDOWPOS_CENTERED 0x2FFF0000
#define SDL_WINDOW_RESIZABLE 0x20
#define SDL_WINDOW_ALLOW_HIGHDPI 0x2000
#define SDL_RENDERER_SOFTWARE 1
#define SDL_RENDERER_ACCELERATED 2
#define SDL_PIXELFORMAT_ARGB8888 0x16362004u
typedef enum { SDL_BLENDMODE_NONE = 0, SDL_BLENDMODE_BLEND = 1 } SDL_BlendMode;

int SDL_Init(Uint32 flags);
void SDL_Quit(void);
const char *SDL_GetError(void);

SDL_Window *SDL_CreateWindow(const char *title, int x, int y, int w, int h, Uint32 flags);
void SDL_DestroyWindow(SDL_Window *w);
void SDL_RaiseWindow(SDL_Window *w);
void SDL_GetWindowSize(SDL_Window *w, int *width, int *height);

SDL_Renderer *SDL_CreateRenderer(SDL_Window *w, int index, Uint32 flags);
SDL_Renderer *SDL_CreateSoftwareRenderer(SDL_Surface *s);
void SDL_DestroyRenderer(SDL_Renderer *r);
int SDL_GetRendererOutputSize(SDL_Renderer *r, int *w, int *h);
int SDL_SetRenderDrawColor(SDL_Renderer *r, Uint8 red, Uint8 green, Uint8 blue, Uint8 alpha);
int SDL_SetRenderDrawBlendMode(SDL_Renderer *r, SDL_BlendMode mode);
int SDL_RenderClear(SDL_Renderer *r);
int SDL_RenderFillRect(SDL_Renderer *r, const SDL_Rect *rect);
int SDL_RenderDrawLine(SDL_Renderer *r, int x1, int y1, int x2, int y2);
int SDL_RenderSetClipRect(SDL_Renderer *r, const SDL_Rect *rect);
int SDL_RenderCopy(SDL_Renderer *r, SDL_Texture *t, const SDL_Rect *src, const SDL_Rect *dst);
void SDL_RenderPresent(SDL_Renderer *r);

SDL_Surface *SDL_CreateRGBSurfaceWithFormat(Uint32 flags, int w, int h, int depth, Uint32 format);
void SDL_FreeSurface(SDL_Surface *s);
SDL_Texture *SDL_CreateTextureFromSurface(SDL_Renderer *r, SDL_Surface *s);
void SDL_DestroyTexture(SDL_Texture *t);
void SDL_GetRGB(Uint32 pixel, const SDL_PixelFormat *format, Uint8 *r, Uint8 *g, Uint8 *b);
int SDL_SaveBMP(SDL_Surface *s, const char *file);

int SDL_WaitEvent(SDL_Event *e);
int SDL_PollEvent(SDL_Event *e);

#endif
