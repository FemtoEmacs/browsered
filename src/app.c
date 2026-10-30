/* C owns startup and the editor loop; Scheme supplies editor policies. */
#include "header.h"
extern int init_scheme(int);
extern char *scheme_eval(char *);
extern int scheme_error;
extern void scheme_install_hooks(void);
int main(int argc, char **argv)
{
#ifndef SBEMACS_GUI
    if (argc > 1 && strcmp(argv[1], "--gui") == 0) {
        char path[4096], resolved[4096];
        if (!realpath(argv[0], resolved)) return 1;
        char *slash = strrchr(resolved, '/');
        if (!slash) return 1;
        *slash = '\0';
        snprintf(path, sizeof(path), "%s/schememax-gui", resolved);
        argv[1] = path;
        execv(path, argv + 1);
        perror("Schememax GUI backend"); return 1;
    }
#endif
    if (argc == 2 && strcmp(argv[1], "--version") == 0) { puts(VERSION); return 0; }
    init_scheme(1024);
    if (argc == 3 && strcmp(argv[1], "--eval") == 0) {
        puts(scheme_eval(argv[2])); return scheme_error ? 1 : 0;
    }
    scheme_install_hooks();
    return fe_main(argc, argv);
}
