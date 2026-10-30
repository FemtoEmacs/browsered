#include <dirent.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <sys/stat.h>
#include "llt/llt.h"
#include "flisp.h"
extern void fe_set_completions(char *);
static value_t set_completions(value_t *args,uint32_t n) {
    argcount("fe-set-completions",n,1);
    fe_set_completions(tostring(args[0],"fe-set-completions"));return FL_T;
}
static value_t files(value_t *args, uint32_t n) {
    argcount("directory-files", n, 1);
    DIR *dir=opendir(tostring(args[0],"directory-files"));
    if(!dir)lerror(IOError,"Cannot read directory");
    value_t result=FL_NIL, name=FL_NIL;fl_gc_handle(&result);fl_gc_handle(&name);
    struct dirent *entry;
    while((entry=readdir(dir))) {
        name=string_from_cstrn(entry->d_name,strlen(entry->d_name));
        result=fl_cons(name,result);
    }
    closedir(dir);fl_free_gc_handles(2);return result;
}
/* Preserve the typed directory prefix; expand ~/ only for filesystem access. */
static value_t file_completions(value_t *args, uint32_t n) {
    argcount("file-completions",n,1);
    char typed[4096];
    const char *source=tostring(args[0],"file-completions");
    if(strlen(source)>=sizeof(typed))return FL_NIL;
    strcpy(typed,source);
    char prefix[4096],directory[4096],path[8192],candidate[8192];
    const char *slash=strrchr(typed,'/'),*base=slash ? slash+1 : typed;
    size_t plen=slash ? (size_t)(slash-typed)+1 : 0;
    if(plen>=sizeof(prefix))return FL_NIL;
    memcpy(prefix,typed,plen);prefix[plen]=0;
    if(prefix[0]=='~' && prefix[1]=='/')
        snprintf(directory,sizeof(directory),"%s/%s",getenv("HOME") ? getenv("HOME") : "",prefix+2);
    else snprintf(directory,sizeof(directory),"%s",plen ? prefix : ".");
    DIR *dir=opendir(directory);
    if(!dir)return FL_NIL;
    value_t result=FL_NIL,name=FL_NIL;fl_gc_handle(&result);fl_gc_handle(&name);
    struct dirent *entry;
    while((entry=readdir(dir))){
        if(!strcmp(entry->d_name,".") || !strcmp(entry->d_name,".."))continue;
        if(entry->d_name[0]=='.' && base[0]!='.')continue;
        if(strncmp(entry->d_name,base,strlen(base)))continue;
        snprintf(path,sizeof(path),"%s/%s",directory,entry->d_name);
        struct stat st;int directory_entry=stat(path,&st)==0 && S_ISDIR(st.st_mode);
        snprintf(candidate,sizeof(candidate),"%s%s%s",prefix,entry->d_name,directory_entry ? "/" : "");
        /* The screen completion protocol separates names with newlines. */
        if(strchr(candidate,'\n'))continue;
        name=string_from_cstrn(candidate,strlen(candidate));result=fl_cons(name,result);
    }
    closedir(dir);fl_free_gc_handles(2);return result;
}
void extra_init(void) {
    static builtinspec_t functions[]={{"directory-files",files},{"file-completions",file_completions},{"fe-set-completions",set_completions},{NULL,NULL}};
    assign_global_builtins(functions);
}
