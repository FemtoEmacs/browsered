/* Browsered's optional local Codex bridge. Build with make codex-bridge.
 * Serves only Browsered.html and invokes the signed-in CLI, never an API key.
 * Protocol: model newline, image-count newline, base64 PNG lines, UTF-8 prompt.
 */
#define _DARWIN_C_SOURCE
#define _DEFAULT_SOURCE
#define _POSIX_C_SOURCE 200809L
#define _XOPEN_SOURCE 700
#include <arpa/inet.h>
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define MAX_BODY (48U * 1024 * 1024)
#define MAX_REPLY (8U * 1024 * 1024)
static char program[PATH_MAX], page[PATH_MAX], host[64], origin[96];
static int port = 8767;

static bool send_all(int fd, const void *data, size_t n) {
    const char *p = data;
    while (n) { ssize_t k = send(fd, p, n, 0); if (k < 0 && errno == EINTR) continue;
        if (k <= 0) return false;
        p += k; n -= (size_t)k;
    }
    return true;
}
static void reply(int fd, int status, const char *type, const char *data, size_t n) {
    const char *reason = status == 200 ? "OK" : status == 400 ? "Bad Request" :
        status == 403 ? "Forbidden" : status == 404 ? "Not Found" :
        status == 413 ? "Content Too Large" : "Bad Gateway";
    char header[512];
    int k = snprintf(header, sizeof(header), "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %zu\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n", status, reason, type, n);
    if (k > 0 && (size_t)k < sizeof(header) && send_all(fd, header, (size_t)k)) send_all(fd, data, n);
}
static void message(int fd, int status, const char *text) {
    reply(fd, status, "text/plain; charset=utf-8", text, strlen(text));
}
static char *read_file(const char *path, size_t limit, size_t *size) {
    FILE *f = fopen(path, "rb"); if (!f) return NULL;
    if (fseek(f, 0, SEEK_END)) { fclose(f); return NULL; }
    long n = ftell(f); rewind(f);
    if (n < 0 || (size_t)n > limit) { fclose(f); return NULL; }
    char *s = malloc((size_t)n + 1); if (!s) { fclose(f); return NULL; }
    size_t k = fread(s, 1, (size_t)n, f); fclose(f);
    if (k != (size_t)n) { free(s); return NULL; }
    s[k] = 0; *size = k; return s;
}
static bool write_file(const char *path, const void *data, size_t size) {
    int fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0600); if (fd < 0) return false;
    const char *p = data; bool ok = true;
    while (size) { ssize_t k = write(fd, p, size); if (k < 0 && errno == EINTR) continue;
        if (k <= 0) { ok = false; break; } p += k; size -= (size_t)k;
    }
    close(fd); return ok;
}
static void private_path(char *out, const char *dir, const char *name) {
    snprintf(out, PATH_MAX, "%s/%s", dir, name);
}
static int run(char *const args[], const char *dir, const char *input, const char *log) {
    pid_t child = fork(); if (child < 0) return -1;
    if (!child) {
        setpgid(0, 0);
        int in = open(input ? input : "/dev/null", O_RDONLY);
        int out = open(log, O_WRONLY | O_CREAT | O_TRUNC, 0600);
        if (in < 0 || out < 0 || chdir(dir)) _exit(126);
        dup2(in, 0); dup2(out, 1); dup2(out, 2); close(in); close(out);
        /* Never let inherited API credentials change the billing path. */
        unsetenv("OPENAI_API_KEY"); unsetenv("CODEX_API_KEY");
        unsetenv("OPENAI_BASE_URL"); unsetenv("CODEX_BASE_URL");
        execv(program, args); _exit(127);
    }
    for (int i = 0; i < 3000; ++i) {
        int status = 0; pid_t k = waitpid(child, &status, WNOHANG);
        if (k == child) return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        if (k < 0 && errno != EINTR) return -1;
        struct timespec pause = {0, 100000000}; nanosleep(&pause, NULL);
    }
    kill(-child, SIGTERM); struct timespec pause = {1, 0}; nanosleep(&pause, NULL);
    kill(-child, SIGKILL); waitpid(child, NULL, 0); return -1;
}
static int base64_value(unsigned char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    return c == '+' ? 62 : c == '/' ? 63 : -1;
}
static bool image_file(const char *path, const char *s) {
    size_t n = strlen(s); if (!n || n % 4) return false;
    unsigned char *out = malloc(n / 4 * 3); if (!out) return false;
    size_t used = 0; bool ok = true;
    for (size_t i = 0; i < n; i += 4) {
        int a = base64_value((unsigned char)s[i]), b = base64_value((unsigned char)s[i+1]);
        int c = s[i+2] == '=' ? 0 : base64_value((unsigned char)s[i+2]);
        int d = s[i+3] == '=' ? 0 : base64_value((unsigned char)s[i+3]);
        if (a < 0 || b < 0 || c < 0 || d < 0 ||
            (s[i+2] == '=' && s[i+3] != '=') ||
            ((s[i+2] == '=' || s[i+3] == '=') && i + 4 != n)) { ok = false; break; }
        out[used++] = (unsigned char)((a << 2) | (b >> 4));
        if (s[i+2] != '=') out[used++] = (unsigned char)((b << 4) | (c >> 2));
        if (s[i+3] != '=') out[used++] = (unsigned char)((c << 6) | d);
    }
    ok = ok && used >= 8 && !memcmp(out, "\x89PNG\r\n\x1a\n", 8) && write_file(path, out, used);
    free(out); if (!ok) unlink(path); return ok;
}
static char *take_line(char **cursor) {
    char *s = *cursor, *end = strchr(s, '\n'); if (!end) return NULL;
    *end = 0; *cursor = end + 1; return s;
}
static void codex_request(int fd, char *body) {
    char *p = body, *model = take_line(&p), *count_text = take_line(&p), *end;
    if (!model || !count_text || strlen(model) > 100 || !*count_text) { message(fd, 400, "Invalid Codex request."); return; }
    for (char *s = model; *s; ++s) if (!isalnum((unsigned char)*s) && !strchr("-._", *s)) { message(fd, 400, "Invalid model name."); return; }
    long count = strtol(count_text, &end, 10);
    if (*end || count < 0 || count > 32) { message(fd, 400, "Invalid page count."); return; }
    char dir[] = "/tmp/browsered-codex-XXXXXX";
    if (!mkdtemp(dir)) { message(fd, 502, "Cannot create private Codex workspace."); return; }
    char input[PATH_MAX], output[PATH_MAX], log[PATH_MAX], images[32][PATH_MAX];
    private_path(input, dir, "prompt.txt"); private_path(output, dir, "answer.txt"); private_path(log, dir, "log.txt");
    int made = 0;
    for (int i = 0; i < count; ++i) {
        char *s = take_line(&p), name[32]; snprintf(name, sizeof(name), "page-%02d.png", i + 1);
        private_path(images[i], dir, name);
        if (!s || !image_file(images[i], s)) { message(fd, 400, "Invalid PNG page attachment."); goto cleanup; }
        made++;
    }
    if (!*p || !write_file(input, p, strlen(p))) { message(fd, 400, "The Codex prompt is empty or cannot be written."); goto cleanup; }
    char *login[] = {program, "-c", "forced_login_method=\"chatgpt\"", "login", "status", NULL};
    int status = run(login, dir, NULL, log); size_t size = 0;
    char *login_text = read_file(log, MAX_REPLY, &size);
    bool signed_in = status == 0 && login_text && strstr(login_text, "Logged in using ChatGPT");
    free(login_text);
    if (!signed_in) { message(fd, 502, "Codex is not signed in with ChatGPT. Run codex login and choose Sign in with ChatGPT. API-key authentication is not used by this bridge."); goto cleanup; }
    char *args[96]; int n = 0;
    args[n++] = program; args[n++] = "-c"; args[n++] = "forced_login_method=\"chatgpt\"";
    args[n++] = "exec"; args[n++] = "--ephemeral"; args[n++] = "--skip-git-repo-check";
    args[n++] = "--sandbox"; args[n++] = "read-only"; args[n++] = "--color"; args[n++] = "never";
    args[n++] = "--cd"; args[n++] = dir; args[n++] = "--output-last-message"; args[n++] = output;
    if (*model) { args[n++] = "--model"; args[n++] = model; }
    for (int i = 0; i < count; ++i) { args[n++] = "--image"; args[n++] = images[i]; }
    args[n++] = "-"; args[n] = NULL;
    status = run(args, dir, input, log);
    char *answer = status == 0 ? read_file(output, MAX_REPLY, &size) : NULL;
    if (answer && size) reply(fd, 200, "text/plain; charset=utf-8", answer, size);
    else {
        char *detail = read_file(log, MAX_REPLY, &size);
        message(fd, 502, detail && *detail ? detail : "Codex did not return an answer (request failed or timed out).");
        free(detail);
    }
    free(answer);
cleanup:
    unlink(input); unlink(output); unlink(log);
    for (int i = 0; i < made; ++i) unlink(images[i]);
    rmdir(dir);
}

/* Explicit shell requests from the editor, restricted to its own origin. */
static void shell_request(int fd, char *body) {
    char *cursor = body, *seconds = take_line(&cursor), *folder = take_line(&cursor), *end;
    if (!seconds || !folder || !*cursor) { message(fd, 400, "Invalid shell request."); return; }
    long limit = strtol(seconds, &end, 10);
    if (*end || limit < 1 || limit > 600) { message(fd, 400, "Invalid shell timeout."); return; }
    char directory[PATH_MAX];
    const char *home = getenv("HOME");
    if (!strcmp(folder, "/") || !*folder) snprintf(directory, sizeof(directory), "%s", home ? home : "/");
    else if (!strncmp(folder, "~/", 2)) snprintf(directory, sizeof(directory), "%s/%s", home ? home : "", folder + 2);
    else snprintf(directory, sizeof(directory), "%s", folder);
    struct stat info;
    if (stat(directory, &info) || !S_ISDIR(info.st_mode)) { message(fd, 400, "Shell starting folder does not exist on this computer."); return; }
    char temp[] = "/tmp/browsered-shell-XXXXXX";
    if (!mkdtemp(temp)) { message(fd, 502, "Cannot create shell workspace."); return; }
    char output[PATH_MAX]; private_path(output, temp, "output");
    pid_t child = fork(); int code = -1;
    if (!child) {
        setpgid(0, 0);
        int in = open("/dev/null", O_RDONLY), out = open(output, O_WRONLY | O_CREAT | O_EXCL, 0600);
        if (in < 0 || out < 0 || chdir(directory)) _exit(126);
        dup2(in, 0); dup2(out, 1); dup2(out, 2); close(in); close(out);
        struct rlimit cap = {MAX_REPLY, MAX_REPLY}; setrlimit(RLIMIT_FSIZE, &cap);
        execl("/bin/sh", "sh", "-c", cursor, (char *)NULL); _exit(127);
    }
    if (child > 0) {
        int status = 0; bool done = false;
        for (long ticks = 0; ticks < limit * 10; ticks++) {
            pid_t k = waitpid(child, &status, WNOHANG);
            if (k == child) { done = true; break; }
            if (k < 0 && errno != EINTR) break;
            struct timespec pause = {0, 100000000}; nanosleep(&pause, NULL);
        }
        if (done) code = WIFEXITED(status) ? WEXITSTATUS(status) : -1;
        kill(-child, SIGKILL);
        if (!done) waitpid(child, NULL, 0);
    }
    size_t size = 0; char *text = read_file(output, MAX_REPLY, &size);
    char *result = malloc(size + 48);
    if (result) { int n = snprintf(result, 48, "%d\n", code);
        if (text) memcpy(result + n, text, size);
        reply(fd, 200, "text/plain; charset=utf-8", result, (size_t)n + size); free(result);
    } else message(fd, 502, "Cannot read shell result.");
    free(text); unlink(output); rmdir(temp);
}

static void json_text(FILE *f, const char *s) {
    fputc('"', f);
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        if (*p == '"' || *p == '\\') { fputc('\\', f); fputc(*p, f); }
        else if (*p < 32) fprintf(f, "\\u%04x", *p);
        else fputc(*p, f);
    }
    fputc('"', f);
}
static void file_info(FILE *f, const char *name, const struct stat *st) {
    fputs("{\"name\":", f); json_text(f, name);
#ifdef __APPLE__
    double milliseconds = (double)st->st_mtimespec.tv_sec * 1000 + st->st_mtimespec.tv_nsec / 1000000.0;
#else
    double milliseconds = (double)st->st_mtim.tv_sec * 1000 + st->st_mtim.tv_nsec / 1000000.0;
#endif
    fprintf(f, ",\"kind\":\"%s\",\"size\":%lld,\"mtime\":%.0f}",
            S_ISDIR(st->st_mode) ? "directory" : "file", (long long)st->st_size,
            milliseconds);
}
/* Filesystem operations requested by Browsered, never by cross-origin pages.
 * Listing/stat/read never create, truncate or write a source file. */
static void files_request(int fd, char *body, size_t length) {
    char *cursor = body, *op = take_line(&cursor), *path = take_line(&cursor);
    if (!op || !path || !*path || strchr(path, '\r')) { message(fd,400,"Invalid file request."); return; }
    char native[PATH_MAX]; const char *home = getenv("HOME");
    int k = !strcmp(path,"~") || !strncmp(path,"~/",2)
        ? snprintf(native,sizeof(native),"%s%s",home ? home : "",path+1)
        : snprintf(native,sizeof(native),"%s",path);
    if (k < 0 || k >= (int)sizeof(native) || native[0] != '/') { message(fd,400,"Use an absolute path or ~/. "); return; }
    struct stat st; bool exists = stat(native,&st) == 0;
    if (!strcmp(op,"read")) {
        size_t n; char *data = exists && S_ISREG(st.st_mode) ? read_file(native,MAX_BODY,&n) : NULL;
        if (!data) message(fd,404,"Cannot read that file.");
        else { reply(fd,200,"application/octet-stream",data,n); free(data); } return;
    }
    if (!strcmp(op,"write")) {
        size_t n = length - (size_t)(cursor-body);
        if ((exists && !S_ISREG(st.st_mode)) || (!n && exists && st.st_size > 0)) { message(fd,400,"Refused to empty or replace a non-regular file."); return; }
        char target[PATH_MAX], temp[PATH_MAX];
        if (exists) { if (!realpath(native,target)) { message(fd,400,"Cannot resolve file."); return; } }
        else snprintf(target,sizeof(target),"%s",native);
        if (snprintf(temp,sizeof(temp),"%s.browsered-XXXXXX",target) >= (int)sizeof(temp)) { message(fd,400,"Path too long."); return; }
        int out = mkstemp(temp); bool ok = out >= 0;
        if (ok) {
            if (exists && fchmod(out,st.st_mode & 0777)) ok = false;
            size_t used = 0;
            while (ok && used < n) { ssize_t wrote = write(out,cursor+used,n-used);
                if (wrote < 0 && errno == EINTR) continue;
                if (wrote <= 0) ok = false; else used += (size_t)wrote;
            }
            if (ok && fsync(out)) ok = false;
            if (close(out)) ok = false;
            if (ok && rename(temp,target)) ok = false;
            if (!ok) unlink(temp);
        }
        message(fd,ok?200:400,ok?"Saved.":"Could not save that file."); return;
    }
    if (!strcmp(op,"mkdir")) {
        bool ok = (exists && S_ISDIR(st.st_mode)) || mkdir(native,0700) == 0;
        message(fd,ok?200:400,ok?"Ready.":"Cannot create folder."); return;
    }
    if (!exists) { message(fd,404,"File or folder does not exist."); return; }
    char *json = NULL; size_t n = 0; FILE *f = open_memstream(&json,&n);
    if (!f) { message(fd,502,"Out of memory."); return; }
    bool ok = true;
    if (!strcmp(op,"stat")) {
        char *slash = strrchr(native,'/'); file_info(f,slash ? slash+1 : native,&st);
    } else if (!strcmp(op,"list") && S_ISDIR(st.st_mode)) {
        DIR *dir = opendir(native);
        if (!dir) ok = false;
        else {
            fputc('[',f); struct dirent *entry; bool first = true;
            while ((entry = readdir(dir))) {
                if (!strcmp(entry->d_name,".") || !strcmp(entry->d_name,"..")) continue;
                struct stat info;
                if (fstatat(dirfd(dir),entry->d_name,&info,0) || (!S_ISDIR(info.st_mode) && !S_ISREG(info.st_mode))) continue;
                if (!first) fputc(',',f);
                first = false;
                file_info(f,entry->d_name,&info);
                if (ftell(f) > MAX_REPLY) { ok = false; break; }
            }
            fputc(']',f); closedir(dir);
        }
    } else ok = false;
    fclose(f);
    if (ok) reply(fd,200,"application/json; charset=utf-8",json,n);
    else message(fd,400,"Cannot list that folder or unknown operation.");
    free(json);
}
static void handle(int fd) {
    struct timeval timeout = {15, 0}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    char header[8192]; size_t used = 0; char *boundary = NULL;
    while (used < sizeof(header) - 1) {
        ssize_t k = recv(fd, header + used, 1, 0); if (k <= 0) return;
        used++; header[used] = 0;
        if ((boundary = strstr(header, "\r\n\r\n"))) break;
    }
    if (!boundary) { message(fd, 400, "Invalid HTTP headers."); return; }
    char method[16], url[256], version[16];
    if (sscanf(header, "%15s %255s %15s", method, url, version) != 3) { message(fd, 400, "Invalid request."); return; }
    if (!strcmp(method, "GET")) { char *query = strchr(url, '?'); if (query) *query = 0; }
    char host_value[128] = "", origin_value[128] = "", content_type[128] = "";
    size_t length = 0; bool has_length = false, valid_length = true;
    for (char *line = strstr(header, "\r\n") + 2; *line && strncmp(line, "\r\n", 2); ) {
        char *next = strstr(line, "\r\n"); if (!next) break; *next = 0;
        char *colon = strchr(line, ':');
        if (colon) { *colon = 0; char *value = colon + 1; while (*value == ' ' || *value == '\t') value++;
            if (!strcasecmp(line, "Host")) snprintf(host_value, sizeof(host_value), "%s", value);
            if (!strcasecmp(line, "Origin")) snprintf(origin_value, sizeof(origin_value), "%s", value);
            if (!strcasecmp(line, "Content-Type")) snprintf(content_type, sizeof(content_type), "%s", value);
            if (!strcasecmp(line, "Content-Length")) { char *end; errno = 0; unsigned long long v = strtoull(value, &end, 10);
                if (has_length || errno || *end || !*value || *value == '-' || v > MAX_BODY) valid_length = false;
                has_length = true; length = v <= MAX_BODY ? (size_t)v : 0;
            }
            if (!strcasecmp(line, "Transfer-Encoding")) valid_length = false;
        }
        line = next + 2;
    }
    if (strcmp(host_value, host)) { message(fd, 403, "Invalid Host."); return; }
    if (!strcmp(method, "GET") && (!strcmp(url, "/") || !strcmp(url, "/Browsered.html"))) {
        size_t size; char *s = read_file(page, 64U * 1024 * 1024, &size);
        if (!s) message(fd, 404, "Browsered.html is missing. Build Browsered first.");
        else { reply(fd, 200, "text/html; charset=utf-8", s, size); free(s); } return;
    }
    if (!strcmp(method, "GET") && !strcmp(url, "/codex/status")) {
        message(fd, 200, "Browsered local Codex bridge: ChatGPT sign-in required; API billing disabled."); return;
    }
    if (strcmp(method, "POST") || (strcmp(url, "/codex") && strcmp(url, "/shell") && strcmp(url, "/files"))) { message(fd, 404, "Not found."); return; }
    if (strcmp(origin_value, origin) || strcmp(content_type, !strcmp(url, "/files") ? "application/x-browsered-files" : !strcmp(url, "/shell") ? "application/x-browsered-shell" : "application/x-browsered-codex")) { message(fd, 403, "Only Browsered's own local page can call Codex."); return; }
    if (!has_length || !valid_length || !length) { message(fd, 413, "Invalid request size."); return; }
    char *body = malloc(length + 1); if (!body) { message(fd, 502, "Out of memory."); return; }
    size_t n = 0;
    while (n < length) { ssize_t k = recv(fd, body + n, length - n, 0); if (k <= 0) break; n += (size_t)k; }
    body[n] = 0;
    if (n != length || (strcmp(url,"/files") && memchr(body, 0, n))) message(fd, 400, "Incomplete or invalid request body.");
    else if (!strcmp(url, "/files")) files_request(fd, body, n);
    else if (!strcmp(url, "/shell")) shell_request(fd, body);
    else codex_request(fd, body);
    free(body);
}
static bool find_codex(void) {
    const char *override = getenv("BROWSERED_CODEX");
    if (override && *override) { snprintf(program, sizeof(program), "%s", override); return access(program, X_OK) == 0; }
    const char *bundled[] = {
        "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
        "/Applications/Codex.app/Contents/Resources/codex", NULL};
    for (int i = 0; bundled[i]; ++i) if (!access(bundled[i], X_OK)) { snprintf(program, sizeof(program), "%s", bundled[i]); return true; }
    const char *path = getenv("PATH"); char *copy = strdup(path ? path : ""); if (!copy) return false;
    char *save, *part = strtok_r(copy, ":", &save); bool found = false;
    while (part) { snprintf(program, sizeof(program), "%s/codex", part); if (!access(program, X_OK)) { found = true; break; } part = strtok_r(NULL, ":", &save); }
    free(copy); return found;
}
int main(int argc, char **argv) {
    bool open_browser = true;
    for (int i = 1; i < argc; ++i) {
        if (!strcmp(argv[i], "--serve")) open_browser = false;
        else if (!strcmp(argv[i], "--port") && i + 1 < argc) {
            char *end; long v = strtol(argv[++i], &end, 10); if (*end || v < 0 || v > 65535) return 2; port = (int)v;
        } else if (!strcmp(argv[i], "--page") && i + 1 < argc) { if (!realpath(argv[++i], page)) { perror("Browsered.html"); return 1; } }
        else { fprintf(stderr, "Usage: %s --page Browsered.html [--serve] [--port 8767]\n", argv[0]); return 2; }
    }
    if (!*page || !find_codex()) { fprintf(stderr, "Browsered: cannot find Browsered.html or Codex. Set BROWSERED_CODEX to the Codex executable.\n"); return 1; }
    signal(SIGPIPE, SIG_IGN); signal(SIGCHLD, SIG_IGN);
    int server = socket(AF_INET, SOCK_STREAM, 0); if (server < 0) return 1;
    fcntl(server, F_SETFD, FD_CLOEXEC);
    int yes = 1; setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
    struct sockaddr_in address = {.sin_family = AF_INET, .sin_port = htons((unsigned short)port), .sin_addr.s_addr = htonl(INADDR_LOOPBACK)};
    if (bind(server, (struct sockaddr *)&address, sizeof(address)) || listen(server, 8)) { perror("Browsered local port"); close(server); return 1; }
    socklen_t address_size = sizeof(address); getsockname(server, (struct sockaddr *)&address, &address_size); port = ntohs(address.sin_port);
    snprintf(host, sizeof(host), "127.0.0.1:%d", port); snprintf(origin, sizeof(origin), "http://%s", host);
    printf("Browsered Codex: %s/\nKeep this launcher running while using the editor.\n", origin); fflush(stdout);
    if (open_browser && !fork()) {
#ifdef __APPLE__
        execl("/usr/bin/open", "open", origin, (char *)NULL);
#else
        execlp("xdg-open", "xdg-open", origin, (char *)NULL);
#endif
        _exit(1);
    }
    for (;;) {
        int fd = accept(server, NULL, NULL); if (fd < 0) { if (errno == EINTR) continue; break; }
        fcntl(fd, F_SETFD, FD_CLOEXEC);
        pid_t worker = fork();
        if (!worker) {
            signal(SIGCHLD, SIG_DFL); close(server); handle(fd);
            /* Rejected POSTs can still have unread bytes. Finish the response
             * before closing, instead of resetting the connection. */
            shutdown(fd, SHUT_WR);
            struct timeval drain_timeout = {1, 0};
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &drain_timeout, sizeof(drain_timeout));
            char discard[4096]; while (recv(fd, discard, sizeof(discard), 0) > 0) {}
            close(fd); _exit(0);
        }
        close(fd);
    }
    close(server); return 0;
}
