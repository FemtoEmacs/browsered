/* Markdown -> native attributed text -> PDF, with mandatory XML styles.
 * cmark-gfm and libxml2 are system libraries on this Mac.
 */
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <CoreText/CoreText.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <stdbool.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Public opaque cmark API declarations; no private structs or node values. */
typedef struct cmark_node cmark_node;
typedef struct cmark_parser cmark_parser;
typedef struct cmark_syntax_extension cmark_syntax_extension;
extern cmark_parser *cmark_parser_new(int);
extern void cmark_parser_feed(cmark_parser *, const char *, size_t);
extern cmark_node *cmark_parser_finish(cmark_parser *);
extern void cmark_parser_free(cmark_parser *);
extern void cmark_node_free(cmark_node *);
extern const char *cmark_node_get_type_string(cmark_node *);
extern const char *cmark_node_get_literal(cmark_node *);
extern cmark_node *cmark_node_first_child(cmark_node *);
extern cmark_node *cmark_node_next(cmark_node *);
extern cmark_node *cmark_node_parent(cmark_node *);
extern int cmark_node_get_heading_level(cmark_node *);
extern int cmark_node_get_list_start(cmark_node *);
extern int cmark_node_get_list_type(cmark_node *);
extern void cmark_gfm_core_extensions_ensure_registered(void);
extern cmark_syntax_extension *cmark_find_syntax_extension(const char *);
extern int cmark_parser_attach_syntax_extension(cmark_parser *, cmark_syntax_extension *);

struct Style {
    char font[128];
    CGFloat size, line_height, spacing, indent;
    CTTextAlignment alignment;
};
struct Rules {
    CGFloat width, height, margin;
    struct Style paragraph, headings[6], code, list, quote, table, rule;
    bool strong, emphasis;
    char inline_code_font[128];
};
struct Render {
    CFMutableAttributedStringRef text;
    const struct Rules *rules;
};

static bool attribute(xmlNode *node, const char *name, char *output, size_t capacity)
{
    xmlChar *value = xmlGetProp(node, (const xmlChar *)name);
    if (!value || strlen((const char *)value) >= capacity) {
        if (value) xmlFree(value);
        return false;
    }
    strcpy(output, (const char *)value);
    xmlFree(value);
    return true;
}
static bool number(xmlNode *node, const char *name, CGFloat *output)
{
    char value[64], *end;
    if (!attribute(node, name, value, sizeof(value))) return false;
    double parsed = strtod(value, &end);
    if (*end || !isfinite(parsed) || parsed < 0 || parsed > 3000) return false;
    *output = parsed;
    return true;
}
static bool read_style(xmlNode *node, struct Style *style)
{
    char alignment[32];
    if (!attribute(node, "font", style->font, sizeof(style->font)) ||
        !number(node, "size", &style->size) || !number(node, "line-height", &style->line_height) ||
        !number(node, "space-after", &style->spacing) || !number(node, "indent", &style->indent) ||
        !attribute(node, "align", alignment, sizeof(alignment))) return false;
    if (style->size < 1 || style->line_height < style->size) return false;
    if (strcmp(alignment, "left") == 0) style->alignment = kCTTextAlignmentLeft;
    else if (strcmp(alignment, "center") == 0) style->alignment = kCTTextAlignmentCenter;
    else if (strcmp(alignment, "right") == 0) style->alignment = kCTTextAlignmentRight;
    else if (strcmp(alignment, "justify") == 0) style->alignment = kCTTextAlignmentJustified;
    else return false;
    return true;
}
static bool read_rules(const char *path, struct Rules *rules)
{
    memset(rules, 0, sizeof(*rules));
    xmlDoc *document = xmlReadFile(path, NULL, XML_PARSE_NONET);
    if (!document || document->intSubset || document->extSubset) {
        if (document) xmlFreeDoc(document);
        return false;
    }
    xmlNode *root = xmlDocGetRootElement(document);
    bool valid = root && xmlStrEqual(root->name, BAD_CAST "markdown-pdf");
    unsigned styles_seen = 0, inline_seen = 0;
    for (xmlNode *node = root ? root->children : NULL; node && valid; node = node->next) {
        if (node->type != XML_ELEMENT_NODE) continue;
        if (xmlStrEqual(node->name, BAD_CAST "page")) {
            valid = number(node, "width", &rules->width) && number(node, "height", &rules->height) && number(node, "margin", &rules->margin);
        } else if (xmlStrEqual(node->name, BAD_CAST "style")) {
            char element[32];
            if (!attribute(node, "element", element, sizeof(element))) { valid = false; break; }
            struct Style *style = NULL;
            unsigned index = 0;
            if (strcmp(element, "paragraph") == 0) style = &rules->paragraph;
            else if (strncmp(element, "heading", 7) == 0 && strlen(element) == 8 && element[7] >= '1' && element[7] <= '6') {
                index = (unsigned)(element[7] - '0'); style = &rules->headings[index - 1];
            } else if (strcmp(element, "code") == 0) { index = 7; style = &rules->code; }
            else if (strcmp(element, "list") == 0) { index = 8; style = &rules->list; }
            else if (strcmp(element, "quote") == 0) { index = 9; style = &rules->quote; }
            else if (strcmp(element, "table") == 0) { index = 10; style = &rules->table; }
            else if (strcmp(element, "rule") == 0) { index = 11; style = &rules->rule; }
            valid = style && read_style(node, style) && !(styles_seen & (1u << index));
            styles_seen |= 1u << index;
        } else if (xmlStrEqual(node->name, BAD_CAST "inline")) {
            char element[32], value[128] = {0};
            valid = attribute(node, "element", element, sizeof(element));
            if (valid && strcmp(element, "strong") == 0) {
                valid = attribute(node, "bold", value, sizeof(value)); rules->strong = strcmp(value, "true") == 0; inline_seen |= 1;
            } else if (valid && strcmp(element, "emph") == 0) {
                valid = attribute(node, "italic", value, sizeof(value)); rules->emphasis = strcmp(value, "true") == 0; inline_seen |= 2;
            } else if (valid && strcmp(element, "code") == 0) {
                valid = attribute(node, "font", rules->inline_code_font, sizeof(rules->inline_code_font)); inline_seen |= 4;
            } else valid = false;
        } else valid = false;
    }
    valid = valid && styles_seen == 0xfff && inline_seen == 7 && rules->width > 2 * rules->margin + 50 &&
        rules->height > 2 * rules->margin + 50 && rules->inline_code_font[0];
    xmlFreeDoc(document);
    return valid;
}

static CTFontRef font_for(const struct Style *style, bool bold, bool italic, const char *family)
{
    CFStringRef name = CFStringCreateWithCString(NULL, family ? family : style->font, kCFStringEncodingUTF8);
    CTFontRef font = CTFontCreateWithName(name, style->size, NULL);
    CFRelease(name);
    CTFontSymbolicTraits traits = (bold ? kCTFontBoldTrait : 0) | (italic ? kCTFontItalicTrait : 0);
    if (traits) {
        CTFontRef changed = CTFontCreateCopyWithSymbolicTraits(font, style->size, NULL, traits, traits);
        if (changed) { CFRelease(font); font = changed; }
    }
    return font;
}
static void append_text(struct Render *render, const char *value, const struct Style *style, bool bold, bool italic, const char *family)
{
    if (!value) return;
    CFStringRef text = CFStringCreateWithCString(NULL, value, kCFStringEncodingUTF8);
    if (!text) return;
    CFIndex start = CFAttributedStringGetLength(render->text), count = CFStringGetLength(text);
    CFAttributedStringReplaceString(render->text, CFRangeMake(start, 0), text);
    CTFontRef font = font_for(style, bold, italic, family);
    CFAttributedStringSetAttribute(render->text, CFRangeMake(start, count), kCTFontAttributeName, font);
    CFRelease(font); CFRelease(text);
}
static void inline_nodes(struct Render *render, cmark_node *parent, const struct Style *style, bool bold, bool italic)
{
    for (cmark_node *node = cmark_node_first_child(parent); node; node = cmark_node_next(node)) {
        const char *type = cmark_node_get_type_string(node);
        if (strcmp(type, "text") == 0 || strcmp(type, "html_inline") == 0) append_text(render, cmark_node_get_literal(node), style, bold, italic, NULL);
        else if (strcmp(type, "softbreak") == 0) append_text(render, " ", style, bold, italic, NULL);
        else if (strcmp(type, "linebreak") == 0) append_text(render, "\n", style, bold, italic, NULL);
        else if (strcmp(type, "code") == 0) append_text(render, cmark_node_get_literal(node), style, bold, italic, render->rules->inline_code_font);
        else inline_nodes(render, node, style, bold || (render->rules->strong && strcmp(type, "strong") == 0), italic || (render->rules->emphasis && strcmp(type, "emph") == 0));
    }
}
static void finish_paragraph(struct Render *render, CFIndex start, const struct Style *style, CGFloat head_indent, CFArrayRef tabs)
{
    append_text(render, "\n", style, false, false, NULL);
    CGFloat first_indent = style->indent;
    CTParagraphStyleSetting settings[] = {
        {kCTParagraphStyleSpecifierAlignment, sizeof(style->alignment), &style->alignment},
        {kCTParagraphStyleSpecifierMinimumLineHeight, sizeof(style->line_height), &style->line_height},
        {kCTParagraphStyleSpecifierMaximumLineHeight, sizeof(style->line_height), &style->line_height},
        {kCTParagraphStyleSpecifierParagraphSpacing, sizeof(style->spacing), &style->spacing},
        {kCTParagraphStyleSpecifierFirstLineHeadIndent, sizeof(first_indent), &first_indent},
        {kCTParagraphStyleSpecifierHeadIndent, sizeof(head_indent), &head_indent},
        {kCTParagraphStyleSpecifierTabStops, sizeof(tabs), &tabs}
    };
    CTParagraphStyleRef paragraph = CTParagraphStyleCreate(settings, tabs ? 7 : 6);
    CFAttributedStringSetAttribute(render->text, CFRangeMake(start, CFAttributedStringGetLength(render->text) - start), kCTParagraphStyleAttributeName, paragraph);
    CFRelease(paragraph);
}
/* Code lines use line spacing; only the last line gets block spacing. */
static void render_code_block(struct Render *render, const char *literal)
{
    if (!literal) return;
    size_t length = strlen(literal), start = 0;
    while (start < length) {
        size_t end = start;
        while (end < length && literal[end] != '\n') ++end;
        char *line = malloc(end - start + 1);
        if (!line) return;
        memcpy(line, literal + start, end - start);
        line[end - start] = '\0';
        struct Style style = render->rules->code;
        if (end + 1 < length) style.spacing = 0;
        CFIndex offset = CFAttributedStringGetLength(render->text);
        append_text(render, line, &style, false, false, NULL);
        finish_paragraph(render, offset, &style, 0, NULL);
        free(line);
        start = end + 1;
    }
}

static void render_blocks(struct Render *render, cmark_node *parent, unsigned depth, bool quoted, const char *marker)
{
    bool marker_used = false;
    for (cmark_node *node = cmark_node_first_child(parent); node; node = cmark_node_next(node)) {
        const char *type = cmark_node_get_type_string(node);
        const struct Style *selected = quoted ? &render->rules->quote : &render->rules->paragraph;
        if (strcmp(type, "code_block") == 0) {
            render_code_block(render, cmark_node_get_literal(node));
            continue;
        }
        if (strcmp(type, "list") == 0) {
            int index = cmark_node_get_list_start(node);
            bool ordered = cmark_node_get_list_type(node) == 2;
            for (cmark_node *item = cmark_node_first_child(node); item; item = cmark_node_next(item)) {
                char prefix[32];
                if (ordered) snprintf(prefix, sizeof(prefix), "%d. ", index++);
                else strcpy(prefix, "• ");
                render_blocks(render, item, depth + 1, quoted, prefix);
            }
            continue;
        }
        if (strcmp(type, "block_quote") == 0) { render_blocks(render, node, depth, true, NULL); continue; }
        if (strcmp(type, "table") == 0) {
            cmark_node *first_row = cmark_node_first_child(node);
            unsigned columns = 0;
            for (cmark_node *cell = first_row ? cmark_node_first_child(first_row) : NULL; cell; cell = cmark_node_next(cell)) ++columns;
            if (!columns) continue;
            CGFloat width = (render->rules->width - 2 * render->rules->margin) / columns;
            CFMutableArrayRef tabs = CFArrayCreateMutable(NULL, 0, &kCFTypeArrayCallBacks);
            for (unsigned column = 1; column < columns; ++column) {
                CTTextTabRef tab = CTTextTabCreate(kCTTextAlignmentLeft, column * width, NULL);
                CFArrayAppendValue(tabs, tab); CFRelease(tab);
            }
            bool header = true;
            for (cmark_node *row = first_row; row; row = cmark_node_next(row)) {
                CFIndex start = CFAttributedStringGetLength(render->text);
                for (cmark_node *cell = cmark_node_first_child(row); cell; cell = cmark_node_next(cell)) {
                    inline_nodes(render, cell, &render->rules->table, header, false);
                    if (cmark_node_next(cell)) append_text(render, "\t", &render->rules->table, false, false, NULL);
                }
                finish_paragraph(render, start, &render->rules->table, 0, tabs);
                header = false;
            }
            CFRelease(tabs); continue;
        }
        if (strcmp(type, "heading") == 0) selected = &render->rules->headings[cmark_node_get_heading_level(node) - 1];
        else if (strcmp(type, "code_block") == 0) selected = &render->rules->code;
        else if (strcmp(type, "thematic_break") == 0) selected = &render->rules->rule;
        else if (strcmp(type, "paragraph") == 0 && depth) selected = &render->rules->list;
        else if (strcmp(type, "paragraph") != 0 && strcmp(type, "html_block") != 0) continue;

        struct Style style = *selected;
        CGFloat head_indent = 0;
        if (depth) { style.indent = (depth - 1) * render->rules->list.indent; head_indent = style.indent + render->rules->list.indent; }
        else if (quoted) head_indent = style.indent;
        CFIndex start = CFAttributedStringGetLength(render->text);
        if (marker && !marker_used) { append_text(render, marker, &style, false, false, NULL); marker_used = true; }
        if (strcmp(type, "code_block") == 0 || strcmp(type, "html_block") == 0) append_text(render, cmark_node_get_literal(node), &style, false, false, NULL);
        else if (strcmp(type, "thematic_break") == 0) append_text(render, "────────────────────", &style, false, false, NULL);
        else inline_nodes(render, node, &style, false, false);
        finish_paragraph(render, start, &style, head_indent, NULL);
    }
}

CFDataRef browsered_create_pdf(const char *input, size_t length, const char *rules_path)
{
    struct Rules rules;
    if (!read_rules(rules_path, &rules)) return NULL; /* Never silently ignore XML. */
    cmark_gfm_core_extensions_ensure_registered();
    cmark_parser *parser = cmark_parser_new(0);
    cmark_syntax_extension *tables = cmark_find_syntax_extension("table");
    if (tables) cmark_parser_attach_syntax_extension(parser, tables);
    cmark_parser_feed(parser, input, length);
    cmark_node *document = cmark_parser_finish(parser);
    cmark_parser_free(parser);
    if (!document) return NULL;
    struct Render render = {CFAttributedStringCreateMutable(NULL, 0), &rules};
    render_blocks(&render, document, 0, false, NULL);
    cmark_node_free(document);
    CFIndex text_length = CFAttributedStringGetLength(render.text);
    if (!text_length) { CFRelease(render.text); return NULL; }

    CFMutableDataRef result = CFDataCreateMutable(NULL, 0);
    CGDataConsumerRef consumer = CGDataConsumerCreateWithCFData(result);
    CGRect page = CGRectMake(0, 0, rules.width, rules.height);
    CGContextRef pdf = CGPDFContextCreate(consumer, &page, NULL);
    CTFramesetterRef layout = CTFramesetterCreateWithAttributedString(render.text);
    CGMutablePathRef path = CGPathCreateMutable();
    CGPathAddRect(path, NULL, CGRectMake(rules.margin, rules.margin, rules.width - 2 * rules.margin, rules.height - 2 * rules.margin));
    CFIndex position = 0;
    bool complete = true;
    while (position < text_length) {
        CGPDFContextBeginPage(pdf, NULL);
        CGContextSetTextMatrix(pdf, CGAffineTransformIdentity);
        CTFrameRef frame = CTFramesetterCreateFrame(layout, CFRangeMake(position, 0), path, NULL);
        CTFrameDraw(frame, pdf);
        CFRange visible = CTFrameGetVisibleStringRange(frame);
        CFRelease(frame);
        CGPDFContextEndPage(pdf);
        if (visible.length <= 0) { complete = false; break; }
        position += visible.length;
    }
    CGPDFContextClose(pdf); CGContextRelease(pdf); CGDataConsumerRelease(consumer);
    CGPathRelease(path); CFRelease(layout); CFRelease(render.text);
    if (!complete) { CFRelease(result); return NULL; }
    return result;
}
