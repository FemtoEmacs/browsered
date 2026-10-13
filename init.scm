; -*- scheme -*-
; Browsered init file, loaded when the editor opens (like Emacs's init.el).
; Edit it, then M-x load-init-file (or reload the page) to apply changes.
; The language is femtoscheme: Scheme (R7RS-small) plus an Emacs-like
; editing API: point, goto-char, insert, delete-region, search-forward,
; re-search-forward, buffer-substring, save-excursion, message, ...
; Positions count characters from 1, as in Emacs. Ctrl+H E shows messages.

; A command is a procedure of no arguments; define-command also makes it
; available to M-x.
(define-command (insert-greeting)
  (insert "Olá, " (or (buffer-file-name) "mundo") "!"))

(define-command (duplicate-line)
  (let ((line (current-line)))
    (end-of-line)
    (insert "\n" line)))

; Key bindings use Emacs notation: C- (Ctrl), M- (Alt), s- (Command),
; S- (Shift), and names such as RET, TAB, SPC, <f5>.
(global-set-key "C-c d" 'duplicate-line)
(global-set-key "C-c t" 'insert-date)
(global-set-key "C-c w" 'count-words)

; More examples:
; (global-set-key "C-c u" 'upcase-region)
; (global-set-key "<f5>" (lambda () (save-buffer) (message "Saved")))
; (define-command (strip-trailing-spaces)
;   (save-excursion
;     (goto-char (point-min))
;     (message "~a lines cleaned" (replace-regexp "[ \t]+$" "" "m"))))
