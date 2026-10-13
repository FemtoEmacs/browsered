; -*- scheme -*-
; Browsered's editing API for femtoscheme, modeled on Emacs Lisp.
; Positions count characters from 1, as in Emacs: (point-min) is 1.
; Regular expressions are JavaScript's.

; Save point and mark around body, as in Emacs.
(define-macro (save-excursion . body)
  (let ((p (gensym)) (m (gensym)))
    `(let ((,p (point)) (,m (mark)))
       (dynamic-wind
        (lambda () #f)
        (lambda () ,@body)
        (lambda ()
          (goto-char ,p)
          (if ,m (set-mark ,m) (deactivate-mark)))))))

; Buffer and point ------------------------------------------------------------

(define (point) (%host-call 'point))
(define (point-min) 1)
(define (point-max) (%host-call 'point-max))
(define (buffer-size) (- (point-max) 1))
(define (bobp) (= (point) (point-min)))
(define (eobp) (= (point) (point-max)))
(define (%clamp pos) (max (point-min) (min (point-max) pos)))

(define (goto-char pos) (%host-call 'goto-char (%clamp pos)) (%clamp pos))
(define (forward-char (n 1)) (goto-char (+ (point) n)))
(define (backward-char (n 1)) (goto-char (- (point) n)))

(define (buffer-substring start end)
  (%host-call 'buffer-substring (%clamp (min start end)) (%clamp (max start end))))
(define (buffer-string) (buffer-substring (point-min) (point-max)))
(define (char-after (pos (point)))
  (and (< pos (point-max)) (>= pos (point-min))
       (string-ref (buffer-substring pos (+ pos 1)) 0)))
(define (char-before (pos (point)))
  (and (> pos (point-min)) (<= pos (point-max))
       (string-ref (buffer-substring (- pos 1) pos) 0)))

; (insert "text" #\c 42) inserts at point and leaves point after the text.
(define (insert . items)
  (%host-call 'insert (apply string (map (lambda (x) (if (string? x) x (%display-string x)))
                                         items)))
  (void))
(define (%display-string x) (with-output-to-string (lambda () (display x))))
(define (delete-region start end)
  (%host-call 'delete-region (%clamp (min start end)) (%clamp (max start end)))
  (void))
(define (delete-char (n 1))
  (let ((p (point))) (delete-region p (+ p n))))
(define (delete-backward-char (n 1))
  (let ((p (point))) (delete-region (- p n) p)))
(define (erase-buffer) (delete-region (point-min) (point-max)))
(define (replace-region start end text)
  (save-excursion
   (goto-char (min start end))
   (delete-region start end)
   (insert text)))

; Mark and region ---------------------------------------------------------

(define (mark) (%host-call 'mark))
(define (set-mark pos) (%host-call 'set-mark (%clamp pos)) pos)
(define (push-mark (pos (point))) (set-mark pos))
(define (deactivate-mark) (%host-call 'set-mark #f) (void))
(define (use-region-p) (and (mark) (not (= (mark) (point)))))
(define (region-active-p) (use-region-p))
(define (region-beginning) (min (point) (or (mark) (point))))
(define (region-end) (max (point) (or (mark) (point))))
(define (region-text) (buffer-substring (region-beginning) (region-end)))

; Lines ----------------------------------------------------------------------

(define (line-beginning-position (pos (point))) (car (%host-call 'line-bounds pos)))
(define (line-end-position (pos (point))) (cadr (%host-call 'line-bounds pos)))
(define (beginning-of-line) (goto-char (line-beginning-position)))
(define (end-of-line) (goto-char (line-end-position)))
(define (bolp) (= (point) (line-beginning-position)))
(define (eolp) (= (point) (line-end-position)))
(define (forward-line (n 1)) (%host-call 'forward-line n))
(define (line-number-at-pos (pos (point))) (%host-call 'line-number pos))
(define (current-line) (buffer-substring (line-beginning-position) (line-end-position)))
(define (goto-line n)
  (goto-char (point-min))
  (forward-line (- n 1)))

; Searching --------------------------------------------------------------------
; Searches move point and set the match data, as in Emacs. With noerror,
; a failed search returns #f instead of signaling an error.

(define *match-data* #f)        ; list of (start end) or #f per group
(define *match-string* #f)      ; the string, after string-match

(define (%search-failed what noerror)
  (if noerror #f (error (string "Search failed: " what))))

(define (search-forward text (bound #f) (noerror #f))
  (let ((m (%host-call 'search text 1 bound)))
    (if m
        (begin (set! *match-data* (list m)) (set! *match-string* #f)
               (goto-char (cadr m)))
        (%search-failed text noerror))))
(define (search-backward text (bound #f) (noerror #f))
  (let ((m (%host-call 'search text -1 bound)))
    (if m
        (begin (set! *match-data* (list m)) (set! *match-string* #f)
               (goto-char (car m)))
        (%search-failed text noerror))))
(define (re-search-forward regexp (bound #f) (noerror #f) (flags ""))
  (let ((m (%host-call 're-search regexp 1 bound flags)))
    (if m
        (begin (set! *match-data* m) (set! *match-string* #f)
               (goto-char (cadr (car m))))
        (%search-failed regexp noerror))))
(define (re-search-backward regexp (bound #f) (noerror #f) (flags ""))
  (let ((m (%host-call 're-search regexp -1 bound flags)))
    (if m
        (begin (set! *match-data* m) (set! *match-string* #f)
               (goto-char (car (car m))))
        (%search-failed regexp noerror))))
(define (looking-at regexp (flags ""))
  (let ((m (%host-call 'looking-at regexp flags)))
    (and m (begin (set! *match-data* m) (set! *match-string* #f) #t))))

; On strings, match positions are 0-based character indexes.
(define (string-match regexp str (start 0) (flags ""))
  (let ((m (%host-call 'string-match regexp str start flags)))
    (and m (begin (set! *match-data* m) (set! *match-string* str) (car (car m))))))

(define (%match-span n)
  (and *match-data* (< n (length *match-data*)) (list-ref *match-data* n)))
(define (match-beginning (n 0)) (let ((s (%match-span n))) (and s (car s))))
(define (match-end (n 0)) (let ((s (%match-span n))) (and s (cadr s))))
(define (match-string (n 0) (str *match-string*))
  (let ((s (%match-span n)))
    (and s (if str (substring str (car s) (cadr s)) (buffer-substring (car s) (cadr s))))))
(define (replace-match text)
  (let ((s (%match-span 0)))
    (if (not s) (error "replace-match: no match"))
    (goto-char (car s))
    (delete-region (car s) (cadr s))
    (insert text)))

(define (regexp-replace regexp str replacement (all #t) (flags ""))
  (%host-call 'regexp-replace regexp str replacement all flags))
(define (replace-regexp-in-string regexp replacement str)
  (regexp-replace regexp str replacement #t))

; Replace every match after point; returns the number of replacements.
(define (replace-string from to)
  (let loop ((n 0))
    (if (search-forward from #f #t)
        (begin (replace-match to) (loop (+ n 1)))
        n)))
(define (replace-regexp regexp to (flags ""))
  (let loop ((n 0))
    (if (re-search-forward regexp #f #t flags)
        (let ((text (match-string 0)))
          (replace-match (regexp-replace regexp text to #f flags))
          (if (= (match-beginning 0) (match-end 0)) (forward-char 1))
          (loop (+ n 1)))
        n)))

; Messages and prompts ----------------------------------------------------------

; (format "~a + ~s" 1 "x") as in SRFI 28; Emacs-style %s %S %d also work.
(define (format template . args)
  (let ((out (open-output-string)) (n (string-length template)))
    (define (next-arg)
      (if (null? args) (error "format: too few arguments for" template))
      (let ((a (car args))) (set! args (cdr args)) a))
    (let loop ((i 0))
      (if (< i n)
          (let ((c (string-ref template i)))
            (if (and (memv c '(#\~ #\%)) (< (+ i 1) n))
                (let ((d (string-ref template (+ i 1))))
                  (case d
                    ((#\a #\s #\d) (if (eqv? d #\s)
                                       (if (eqv? c #\~) (write (next-arg) out) (display (next-arg) out))
                                       (display (next-arg) out)))
                    ((#\S) (write (next-arg) out))
                    ((#\%) (if (eqv? c #\~) (newline out) (write-char #\% out)))
                    ((#\~) (write-char #\~ out))
                    (else (write-char c out) (write-char d out)))
                  (loop (+ i 2)))
                (begin (write-char c out) (loop (+ i 1)))))))
    (get-output-string out)))

(define (message template . args)
  (let ((text (if (null? args) (%display-string template) (apply format template args))))
    (%host-call 'message text)
    text))
; (read-string is R7RS's port procedure; Emacs's prompt is this one.)
(define (read-from-minibuffer prompt (initial ""))
  (or (%host-call 'read-string prompt initial)
      (error "Quit")))
(define (read-number prompt (initial ""))
  (let ((n (string->number (read-from-minibuffer prompt initial))))
    (or n (error "Not a number"))))
(define (y-or-n-p prompt) (%host-call 'y-or-n-p prompt))
(define (yes-or-no-p prompt) (y-or-n-p prompt))

; Kill ring, undo, files ----------------------------------------------------------

(define (kill-new text) (%host-call 'kill-new text) text)
(define (current-kill) (%host-call 'current-kill))
(define (kill-region start end)
  (kill-new (buffer-substring start end))
  (delete-region start end))
(define (copy-region-as-kill start end) (kill-new (buffer-substring start end)))
(define (undo) (%host-call 'undo) (void))
(define (buffer-file-name) (%host-call 'file "name"))

; Commands and key bindings ----------------------------------------------------------
; A command is a procedure of no arguments. define-command also makes it
; available to M-x under its name.

(define *commands* (table))
(define *global-map* (table))

(define (%register-command name proc)
  (put! *commands* name proc)
  (%host-call 'add-command (symbol->string name))
  name)

(define-macro (define-command head . body)
  (let ((name (if (pair? head) (car head) head)))
    `(begin (define ,head ,@body)
            (%register-command ',name ,name))))

(define (global-set-key keys command)
  (let ((canonical (%host-call 'bind-key keys)))
    (put! *global-map* canonical command)
    canonical))
(define (global-unset-key keys)
  (let ((canonical (%host-call 'bind-key keys)))
    (%host-call 'unbind-key canonical)
    (del! *global-map* canonical)
    canonical))
(define (key-binding keys) (get *global-map* (%host-call 'bind-key keys) #f))

(define (call-command command)
  (cond ((procedure? command) (command))
        ((and (symbol? command) (has? *commands* command)) ((get *commands* command)))
        ((and (symbol? command) (bound? command)) ((top-level-value command)))
        (else (error "Not a command:" command))))
(define (execute-command name) (call-command (if (string? name) (string->symbol name) name)))

(define (%run-key keys)
  (let ((command (get *global-map* keys #f)))
    (if command (call-command command) (error (string keys " is not bound")))))
(define (%run-command-named name) (execute-command (string->symbol name)))

(define (command-names) (sort (map symbol->string (table.keys *commands*)) string<?))

; Evaluation commands ------------------------------------------------------------

(define (eval-string text)
  (let ((in (open-input-string text)))
    (let loop ((value (void)))
      (let ((form (read in)))
        (if (eof-object? form) value (loop (eval form)))))))

(define (%show-value value) (message "~s" value) value)

(define-command (eval-buffer)
  (eval-string (buffer-string))
  (message "Evaluated the buffer"))
(define-command (eval-region)
  (%show-value (eval-string (region-text))))
; C-x C-e: evaluate the expression before point and insert its value
; after it, so the text calculates: "(* 3 4 5)" becomes "(* 3 4 5) 60".
; Values are inserted as display shows them (strings without quotes).
(define-command (eval-last-sexp)
  (let ((bounds (%host-call 'last-sexp)))
    (if (not bounds) (error "No expression before point"))
    (let ((value (eval-string (buffer-substring (car bounds) (cadr bounds)))))
      (let ((before (char-before)))
        (insert (if (and before (not (char-whitespace? before))) " " "")
                (%display-string value)))
      (%show-value value))))
; Show the value only, without changing the text (also M-:).
(define-command (eval-last-sexp-show)
  (let ((bounds (%host-call 'last-sexp)))
    (if (not bounds) (error "No expression before point"))
    (%show-value (eval-string (buffer-substring (car bounds) (cadr bounds))))))
(define-command (eval-and-replace)      ; replace the sexp before point by its value
  (eval-and-insert))
(define-command (eval-and-insert)
  (let ((bounds (%host-call 'last-sexp)))
    (if (not bounds) (error "No expression before point"))
    (let ((value (eval-string (buffer-substring (car bounds) (cadr bounds)))))
      (delete-region (car bounds) (cadr bounds))
      (goto-char (car bounds))
      (insert (%write-string value)))))
(define-command (load-init-file) (%host-call 'reload-init) (message "Loading the init file"))
; In Edge or Chrome without Browsered.app, the init file lives in the
; browser: pick a file, or use the text being edited.
(define-command (choose-init-file) (%host-call 'choose-init))
(define-command (use-buffer-as-init)
  (if (not (%host-call 'store-init (buffer-string)))
      (error "Browser storage is unavailable"))
  (eval-string (buffer-string))
  (message "This text is now your init file; it loads each time Browsered opens"))
(define-command (forget-init-file)
  (%host-call 'store-init #f)
  (message "Init file removed from this browser; the example init.scm will load"))

; A few ordinary editing commands -------------------------------------------------

(define-command (find-file) (%host-call 'file "open"))
(define-command (save-buffer) (%host-call 'file "save"))
(define-command (write-file) (%host-call 'file "saveAs"))
(define-command (upcase-region)
  (replace-region (region-beginning) (region-end) (string-upcase (region-text))))
(define-command (downcase-region)
  (replace-region (region-beginning) (region-end) (string-downcase (region-text))))
(define-command (what-line) (message "Line ~a" (line-number-at-pos)))
(define-command (count-words)
  (let* ((text (if (use-region-p) (region-text) (buffer-string)))
         (words (filter (lambda (w) (not (string-null? w)))
                        (string-split text " \t\n\r"))))
    (message "~a lines, ~a words, ~a characters"
             (length (string-split text "\n")) (length words) (string-length text))))
(define-command (sort-lines)
  (let* ((start (save-excursion (goto-char (region-beginning)) (line-beginning-position)))
         (end (save-excursion (goto-char (region-end)) (line-end-position)))
         (lines (string-split (buffer-substring start end) "\n")))
    (replace-region start end (string-join (sort lines string<?) "\n"))))
(define-command (goto-line-command) (goto-line (read-number "Go to line: ")))
(define-command (insert-date)
  (insert (time.string (time.now))))
(define-command (list-commands)
  (message "~a" (string-join (command-names) " ")))
