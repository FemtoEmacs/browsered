;; Request: (source globals defined legacy-command? [allow-editor-procedures?]).
;; Source is read, expanded and compiled; it is never executed by this module.
(define request (call-with-input-file ":schemer-request" read))
(set! *browsered-globals* (cadr request))
(set! *browsered-defined* (caddr request))
(set! *browsered-legacy-command* (cadddr request))
(set! *editor-procedures* (if (null? (cddddr request)) #t (car (cddddr request))))
(define user-forms (let ((port (open-input-string (car request))))
  (let loop ((out '())) (let ((x (read port))) (if (eof-object? x) (reverse out) (loop (cons x out)))))))
(define generated-bytes (compile-program user-forms compiled-prelude))
(for-each (lambda (byte) (write-char (string-ref "0123456789abcdef" (quotient byte 16)))
                        (write-char (string-ref "0123456789abcdef" (modulo byte 16)))) generated-bytes)
#t
