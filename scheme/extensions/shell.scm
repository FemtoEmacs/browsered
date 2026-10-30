;;;; shell.scm -- M-!: run a command of the operating system
;;;;
;;;; Port of SBEmacs's lisp/extensions/shell.lisp.
;;;;
;;;; M-! (or C-x @) opens a window below the file, *shell-command*, where the
;;;; command is written: one line, or several (Enter breaks the line).  C-c s
;;;; runs it; *output* then shows the command, as the shell got it, and
;;;; below it what the command printed, with its exit status when it
;;;; failed.  C-x 1 closes the window; M-! again writes another command.
;;;;
;;;; A command of several lines is one command: each line break becomes
;;;; " \" and a break, the shell's continuation.  The command runs in the
;;;; folder of the file it was called from and reads nothing (its input is
;;;; empty, so it cannot wait for the keyboard).

(define *shell-command-buffer* "*shell-command*")
(define *shell-output-buffer* "*output*")
(define *shell-timeout* 600)

(defvar *shell-directory* #f)
(defvar *shell-origin* #f)

(define (shell-command-line text)
  "TEXT, written on one or more lines, as the shell gets it: one command
whose line breaks are continuations."
  (let ((lines (filter (lambda (l) (not (string=? l "")))
                       (map (lambda (l) (string-trim-right (trim-bytes-right l " \t\r"))) (split-lines text)))))
    (let loop ((ls lines) (acc ""))
      (cond ((null? ls) acc)
            ((null? (cdr ls)) (string-append acc (car ls)))
            (else
             (let ((line (car ls)))
               (loop (cdr ls)
                     (string-append acc line
                                    ;; a line that already ends in \ is continued as it is
                                    (if (and (> (length line) 0) (= (aref line (- (length line) 1)) 92)) "" " \\")
                                    "\n"))))))))

(define (run-shell command directory)
  "Run COMMAND with /bin/sh in DIRECTORY: two values, what it printed (its
errors too) and its exit status (#f when it could not run)."
  (let* ((r (run-program "/bin/sh" (list "-c" (string-append "exec 2>&1\n" command)) "" *shell-timeout*
                         (and directory (directory-p directory) directory)))
         (out (remove-byte (car r) 13))
         (code (caddr r)))
    (if (< code 0)
        (values (string-append out (cadr r) "\n") #f)
        (values out code))))

(defcommand (shell-command-window)
  "M-!: a window below, to write a shell command (Enter: more lines);
C-c s runs it."
  (let ((origin (get-buffer-name)))
    (unless (member origin (list *shell-command-buffer* *shell-output-buffer*))
      (set! *shell-origin* origin)
      (set! *shell-directory*
            (let ((file (buffer-filename)))
              (if file (let ((d (file-name-directory (absolute-path file)))) (if (string=? d "") (path.cwd) d))
                  (path.cwd)))))
    (delete-other-windows)
    ;; pressed again in *output*: the file goes back above
    (when (and *shell-origin* (member (get-buffer-name) (list *shell-command-buffer* *shell-output-buffer*)))
      (select-buffer *shell-origin*))
    (split-window)
    (other-window)
    (select-buffer *shell-command-buffer*)
    (erase-buffer)
    (message "Write the command (Enter for another line); [SEND] or C-c s runs it"))
  #t)

(define (shell-transcript command output code)
  "What *output* shows: the command, as the shell got it, then OUTPUT."
  (string-append
   (let loop ((ls (split-lines command)) (first #t) (acc ""))
     (if (null? ls) acc
         (loop (cdr ls) #f (string-append acc (if first "$ " "  ") (car ls) "\n"))))
   output
   (if (or (= (length output) 0) (= (aref output (- (length output) 1)) 10)) "" "\n")
   (if (and code (not (= code 0))) (concat "[exit status " code "]\n") "")))

(define (show-shell-output command output code)
  (select-buffer *shell-output-buffer*)
  (erase-buffer)
  (insert (shell-transcript command output code))
  (fe-set-modified 0)
  (goto-char 0))

(defcommand (shell-command-run)
  "C-c s: run the command written in the window M-! opened."
  (if (not (string=? (get-buffer-name) *shell-command-buffer*))
      (message "M-! opens a window for a command; C-c s there runs it")
      (let* ((text (trim (buffer-substring 0 (buffer-size))))
             (command (shell-command-line text)))
        (if (= (length command) 0)
            (message "Write a command first; C-c s runs it")
            (begin
              (message "Running: " (car (split-lines command)))
              (update-display)
              (let-values (((output code) (guard (e (#t (values (concat (describe-error e) "\n") #f)))
                                            (run-shell command *shell-directory*))))
                (fe-set-modified 0)
                (show-shell-output command output code)
                (if (and code (not (= code 0)))
                    (message "The command failed (exit status " code ")")
                    (message "Done")))))))
  #t)

(define (shell-command command)
  "For scripts: run COMMAND in the current folder and show *output* in this
window, with the command first."
  (let-values (((output code) (guard (e (#t (values (concat (describe-error e) "\n") #f)))
                                (run-shell command (path.cwd)))))
    (show-shell-output command output code))
  #t)

;;; Closing.  In these windows the cursor is in the shell window, so C-x 1
;;; would keep it and close the file; here C-x 1 closes them and keeps the
;;; file.  Elsewhere C-x 1 is what it always was.

(define (shell-buffer-p name) (and (member name (list *shell-command-buffer* *shell-output-buffer*)) #t))

(defcommand (shell-close)
  "Close the shell command window; the file it was called from stays."
  (delete-other-windows)
  (when (and *shell-origin* (shell-buffer-p (get-buffer-name)))
    (select-buffer *shell-origin*))
  (clear-message-line)
  #t)

(defcommand (one-window)
  "C-x 1: keep only this window -- but in the shell windows, close them."
  (if (shell-buffer-p (get-buffer-name))
      (shell-close)
      (execute-builtin "delete-other-windows"))
  #t)

;;; The windows' own buttons (menu.scm), clicked or typed alike
(set-buffer-menu *shell-command-buffer* '(("SEND - C-c s" "C-c s") ("CLOSE - C-x 1" "C-x 1")))
(set-buffer-menu *shell-output-buffer* '(("NEW - M-!" "M-!") ("CLOSE - C-x 1" "C-x 1")))
(set-buffer-hint *shell-command-buffer* "")
(set-buffer-hint *shell-output-buffer* "")

(global-set-key "C-x 1" 'one-window)
(global-set-key "M-!" 'shell-command-window)
(global-set-key "C-x @" 'shell-command-window)
(global-set-key "C-c s" 'shell-command-run)
