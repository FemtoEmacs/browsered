/* Verify generated PDF operators and resources, not just source parsing. */
#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
CFDataRef browsered_create_pdf(const char *, size_t, const char *);
struct Evidence { bool bold, italic, mono, expected_size; double size; };
static void scan_font(CGFloat unused) { (void)unused; }
static void font_resource(const char *key, CGPDFObjectRef object, void *context)
{
    (void)key;
    struct Evidence *evidence = context;
    CGPDFDictionaryRef font;
    const char *name;
    if (CGPDFObjectGetValue(object, kCGPDFObjectTypeDictionary, &font) && CGPDFDictionaryGetName(font, "BaseFont", &name)) {
        if (strstr(name, "Bold")) evidence->bold = true;
        if (strstr(name, "Italic")) evidence->italic = true;
        if (strstr(name, "Menlo")) evidence->mono = true;
    }
}
static void text_font(CGPDFScannerRef scanner, void *context)
{
    CGPDFReal size;
    const char *name;
    struct Evidence *evidence = context;
    if (CGPDFScannerPopNumber(scanner, &size) && CGPDFScannerPopName(scanner, &name)) {
        if (size == evidence->size) evidence->expected_size = true;
    }
}
static void text_matrix(CGPDFScannerRef scanner, void *context)
{
    CGPDFReal values[6];
    for (int index = 5; index >= 0; --index) {
        if (!CGPDFScannerPopNumber(scanner, &values[index])) return;
    }
    struct Evidence *evidence = context;
    if (values[0] == evidence->size || values[3] == evidence->size) evidence->expected_size = true;
}
static char *read_file(const char *path)
{
    FILE *file = fopen(path, "rb");
    if (!file) return NULL;
    fseek(file, 0, SEEK_END); long size = ftell(file); rewind(file);
    char *text = calloc((size_t)size + 1, 1);
    if (text && fread(text, 1, (size_t)size, file) != (size_t)size) { free(text); text = NULL; }
    fclose(file); return text;
}
static bool inspect(CFDataRef data, double width, double font_size, bool expect_styles)
{
    CGDataProviderRef provider = CGDataProviderCreateWithCFData(data);
    CGPDFDocumentRef document = CGPDFDocumentCreateWithProvider(provider);
    if (!document) { CGDataProviderRelease(provider); return false; }
    CGPDFPageRef page = CGPDFDocumentGetPage(document, 1);
    CGRect bounds = CGPDFPageGetBoxRect(page, kCGPDFMediaBox);
    struct Evidence evidence = {.size = font_size};
    CGPDFDictionaryRef resources, fonts;
    if (CGPDFDictionaryGetDictionary(CGPDFPageGetDictionary(page), "Resources", &resources) && CGPDFDictionaryGetDictionary(resources, "Font", &fonts)) {
        CGPDFDictionaryApplyFunction(fonts, font_resource, &evidence);
    }
    CGPDFOperatorTableRef operators = CGPDFOperatorTableCreate();
    CGPDFOperatorTableSetCallback(operators, "Tf", text_font);
    CGPDFOperatorTableSetCallback(operators, "Tm", text_matrix);
    CGPDFContentStreamRef stream = CGPDFContentStreamCreateWithPage(page);
    CGPDFScannerRef scanner = CGPDFScannerCreate(stream, operators, &evidence);
    bool scanned = CGPDFScannerScan(scanner);
    CGPDFScannerRelease(scanner); CGPDFContentStreamRelease(stream); CGPDFOperatorTableRelease(operators);
    printf("width=%.8f wanted=%.8f scanned=%d size=%d bold=%d italic=%d mono=%d\n", bounds.size.width, width, scanned, evidence.expected_size, evidence.bold, evidence.italic, evidence.mono);
    bool valid = scanned && bounds.size.width == width && evidence.expected_size &&
        (!expect_styles || (evidence.bold && evidence.italic && evidence.mono));
    CGPDFDocumentRelease(document); CGDataProviderRelease(provider);
    return valid;
}
int main(int argc, char **argv)
{
    (void)scan_font;
    if (argc != 5) return 1;
    char *sample = read_file(argv[1]);
    if (!sample) return 1;
    CFDataRef standard = browsered_create_pdf(sample, strlen(sample), argv[2]);
    if (!standard || !inspect(standard, 595.28, 22, true)) { puts("FAIL Markdown fonts or XML dimensions"); return 1; }
    CFRelease(standard); puts("PASS Markdown bold, italic, code and heading styles in PDF");
    CFDataRef changed = browsered_create_pdf(sample, strlen(sample), argv[3]);
    if (!changed || !inspect(changed, 420, 30, false)) { puts("FAIL XML changes were ignored"); return 1; }
    CFRelease(changed); puts("PASS changed XML controls page width and heading size");
    CFDataRef missing = browsered_create_pdf(sample, strlen(sample), "/nonexistent/browsered-formatting.xml");
    if (missing) { CFRelease(missing); return 1; }
    puts("PASS missing XML fails instead of silently falling back");
    CFDataRef invalid = browsered_create_pdf(sample, strlen(sample), argv[4]);
    if (invalid) { CFRelease(invalid); return 1; }
    puts("PASS incomplete XML fails instead of discarding rules");
    free(sample); return 0;
}
