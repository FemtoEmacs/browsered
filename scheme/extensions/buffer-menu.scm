;;;; buffer-menu.scm -- C-x C-b
;;;;
;;;; Port of SBEmacs's lisp/extensions/buffer-menu.lisp (originally
;;;; samples/bufmenu.scm, Hugh Barney, September 2016).
;;;;
;;;; Lists the buffers; move with the arrow keys (or C-n / C-p), then
;;;;   1  switch to the buffer as a single window
;;;;   2  split the screen between that buffer and the original one
;;;;   s  save the buffer if modified
;;;;   k  kill the buffer
;;;;   x  exit the menu

(define *bufm-start-line* 3)   ; buffer names start on line 3
(define *bufm-max-ops* 400)
(define *bufm-line* 3)
(define *bufm-last-line* 3)
(define *bufm-stop* #f)
(define *bufm-obuf* "")
(define *bufm-buf* "")

(define (bufm-get-bufn)
  "The buffer name on line *BUFM-LINE* of the *buffers* listing."
  (goto-line *bufm-line*)
  (let ((line (current-line-text)))
    (beginning-of-line)
    (trim (byte-substring line (min 11 (length line)) (min 27 (length line))))))

(define (bufm-buffer-names)
  (let ((saved *bufm-line*))
    (let loop ((l *bufm-start-line*) (acc '()))
      (if (> l *bufm-last-line*)
          (begin (set! *bufm-line* saved) (reverse acc))
          (begin (set! *bufm-line* l) (loop (+ l 1) (cons (bufm-get-bufn) acc)))))))

(define (bufm-move-line n)
  (set! *bufm-line* (max *bufm-start-line* (min (+ *bufm-line* n) *bufm-last-line*))))

(define (bufm-refresh-limits)
  ;; *buffers* itself is not listed, hence the -2
  (set! *bufm-last-line* (+ *bufm-start-line* (get-buffer-count) -2)))

(define (bufm-handle-bound-key)
  (let ((binding (get-key-binding)))
    (cond ((string=? binding "previous-line") (bufm-move-line -1))
          ((string=? binding "next-line") (bufm-move-line 1))))
  (set! *bufm-buf* (bufm-get-bufn)))

(define (bufm-handle-single-key k)
  (let ((several (> (get-buffer-count) 1)))
    (cond ((string=? k "x")
           (if (member *bufm-obuf* (bufm-buffer-names))
               (select-buffer *bufm-obuf*)
               (select-buffer "*scratch*"))
           (set! *bufm-stop* #t))
          ((and (string=? k "1") several)
           (select-buffer *bufm-buf*) (delete-other-windows) (set! *bufm-stop* #t))
          ((and (string=? k "2") several)
           (select-buffer *bufm-buf*) (split-window) (select-buffer *bufm-obuf*) (other-window)
           (set! *bufm-stop* #t))
          ((and (string=? k "s") several)
           (save-buffer *bufm-buf*) (list-buffers) (goto-line *bufm-line*))
          ((and (string=? k "k") several)
           (kill-buffer *bufm-buf*) (list-buffers) (bufm-refresh-limits) (bufm-move-line 0)
           (set! *bufm-buf* (bufm-get-bufn))))))

(defcommand (buffer-menu)
  "C-x C-b: the buffers; 1, 2, s, k, x."
  (set! *bufm-obuf* (get-buffer-name))
  (list-buffers)
  (set! *bufm-line* *bufm-start-line*)
  (set! *bufm-stop* #f)
  (bufm-refresh-limits)
  (delete-other-windows)
  (set! *bufm-buf* (bufm-get-bufn))
  (let loop ((n 0))
    (when (and (< n *bufm-max-ops*) (not *bufm-stop*))
      (message "buffer menu: 1,2,s,k,x")
      (update-display)
      (let ((key (get-key)))
        (if (string=? key "") (bufm-handle-bound-key) (bufm-handle-single-key key)))
      (loop (+ n 1))))
  (clear-message-line)
  (update-display))
