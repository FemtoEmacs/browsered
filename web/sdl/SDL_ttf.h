/*
 * SDL_ttf.h, Browsered: the part of SDL_ttf that irene-dixe uses.  In the
 * browser the text is drawn with the page's own fonts (src/web-sdl.c), so
 * no font file is read: TTF_OpenFont takes the size and ignores the path.
 */
#ifndef BROWSERED_SDL_TTF_H
#define BROWSERED_SDL_TTF_H

#include "SDL.h"

typedef struct TTF_Font TTF_Font;
#define TTF_STYLE_BOLD 1

int TTF_Init(void);
void TTF_Quit(void);
const char *TTF_GetError(void);
TTF_Font *TTF_OpenFont(const char *file, int ptsize);
void TTF_CloseFont(TTF_Font *f);
void TTF_SetFontStyle(TTF_Font *f, int style);
int TTF_FontLineSkip(const TTF_Font *f);
int TTF_SizeUTF8(TTF_Font *f, const char *text, int *w, int *h);
SDL_Surface *TTF_RenderUTF8_Blended(TTF_Font *f, const char *text, SDL_Color fg);

#endif
