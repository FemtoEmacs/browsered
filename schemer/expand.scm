;;;; expand.scm -- Schemer: from Scheme to the core language
;;;;
;;;; The derived forms (let, let*, letrec, named let, cond, case, and, or,
;;;; when, unless, do, quasiquote, internal define, time) become the
;;;; core forms below, and every variable is resolved: a local variable
;;;; becomes a record of its own, a free one is global.
;;;;
;;;;   (const v)  (lref var)  (gref sym)  (lset var e)  (gset sym e)
;;;;   (gdef sym e)  (if t c a)  (seq e ...)  (lambda req rest body)
;;;;   (let ((var e) ...) body)  (letrec ((var e) ...) body)
;;;;   (call f arg ...)  (prim op arg ...)

;;; A local variable: #(name id assigned? captured?)
(define *var-counter* 0)
(define (make-var name)
  (set! *var-counter* (+ *var-counter* 1))
  (vector name *var-counter* #f #f))
(define (var-name v) (vector-ref v 0))
(define (var-assigned? v) (vector-ref v 2))
(define (var-assigned! v) (vector-set! v 2 #t))

;;; The primitives the compiler writes inline (compiler.scm); with their
;;; number of arguments, or #f for any.  Used as values, they are the
;;; procedures of the same name in prelude.scm.
(define *primitives*
  '((+ . #f) (- . #f) (* . #f) (< . 2) (> . 2) (<= . 2) (>= . 2) (= . 2)
    (quotient . 2) (remainder . 2) (modulo . 2) (zero? . 1)
    (cons . 2) (car . 1) (cdr . 1) (set-car! . 2) (set-cdr! . 2)
    (null? . 1) (pair? . 1) (eq? . 2) (not . 1) (boolean? . 1) (symbol? . 1)
    (string? . 1) (char? . 1) (vector? . 1) (procedure? . 1) (fixnum? . 1) (flonum? . 1) (%int? . 1)
    (vector-ref . 2) (vector-set! . 3) (vector-length . 1) (%make-vector . 2)
    (string-length . 1) (string-ref . 2) (string-set! . 3) (%make-string . 2)
    (char->integer . 1) (integer->char . 1)
    (%symbol-name . 1) (%make-symbol . 1)
    (%write-char . 1) (%write-flonum . 1) (%flonum-char . 2) (%string-copy! . 5) (%vector-copy! . 5) (%abort . 1) (%now . 0) (%math . 2) (%math2 . 3)
    (%apply . 2) (%num-add . 2) (%num-sub . 2) (%num-mul . 2) (%num-div . 2)
    (%num-lt . 2) (%num-eq . 2) (%to-flonum . 1) (%flonum-floor . 1) (%flonum->fixnum . 1)
    (%flonum-sqrt . 1) (%eqv? . 2) (%unspecified . 0) (%eof . 0)
    (%make-record . 2) (%record? . 1) (%record-tag . 1) (%record-fields . 1)
    (%catch . 2) (%throw . 2) (%protect . 2) (%number-char . 1) (%number-end . 0) (%table . 4) (%file . 3) (%editor . 1)))

(define (primitive? sym env)
  (and (symbol? sym) (not (lookup sym env)) (assq (global-name sym) *primitives*)))

(define (cxr? sym)
  ;; c[ad]+r, up to four letters
  (let ((s (symbol->string sym)))
    (and (> (string-length s) 2) (< (string-length s) 7)
         (char=? (string-ref s 0) #\c)
         (char=? (string-ref s (- (string-length s) 1)) #\r)
         (let loop ((i 1))
           (or (= i (- (string-length s) 1))
               (and (memv (string-ref s i) '(#\a #\d)) (loop (+ i 1))))))))

(define (syntax-error msg form) (error (string-append "Schemer: " msg) form))

;;; ------------------------------------------------------------------
;;; Expressions
;;; ------------------------------------------------------------------

(define (sch-expand x env)
  (cond ((symbol? x)
         (let ((b (lookup x env)))
           (cond ((macro-binding? b) (syntax-error "a macro used as a variable" (strip x)))
                 (b (list 'lref b))
                 (else (list 'gref (global-name x))))))
        ((pair? x) (expand-pair x env))
        ((null? x) (syntax-error "empty combination ()" x))
        (else (list 'const x))))

(define (expand-pair x env)
  (let* ((head (car x)) (args (cdr x))
         (b (and (symbol? head) (lookup head env))))
    (cond
     ((macro-binding? b) (sch-expand (apply-macro (cdr b) x) env))
     ((and (symbol? head) (not b))
        (case (global-name head)
          ((quote) (list 'const (strip (car args))))
          ((quasiquote) (sch-expand (quasi (car args) 1) env))
          ((if) (list 'if (sch-expand (car args) env) (sch-expand (cadr args) env)
                      (if (pair? (cddr args)) (sch-expand (caddr args) env) '(prim %unspecified))))
          ((define define-values define-record-type define-syntax)
           (syntax-error "a definition is allowed only at the top or at the start of a body" (strip x)))
          ((set!) (let ((v (lookup (car args) env)))
                    (cond ((macro-binding? v) (syntax-error "set! of a macro" (strip x)))
                          (v (var-assigned! v) (list 'lset v (sch-expand (cadr args) env)))
                          (else (list 'gset (global-name (car args)) (sch-expand (cadr args) env))))))
          ((let-syntax letrec-syntax) (expand-let-syntax (car args) (cdr args) env))
          ((let-values) (sch-expand (expand-let-values (car args) (cdr args)) env))
          ((let*-values) (sch-expand (expand-let*-values (car args) (cdr args)) env))
          ((receive) (sch-expand (list 'call-with-values (list 'lambda '() (cadr args))
                                       (cons 'lambda (cons (car args) (cddr args))))
                                 env))
          ((case-lambda) (sch-expand (expand-case-lambda args) env))
          ((parameterize) (sch-expand (list '%parameterize (cons 'list (map car (car args)))
                                            (cons 'list (map cadr (car args)))
                                            (cons 'lambda (cons '() (cdr args))))
                                      env))
          ((guard) (sch-expand (expand-guard (car args) (cdr args)) env))
          ((cond-expand) (sch-expand (cons 'begin (cond-expand-forms args)) env))
          ((assert) (sch-expand (list 'if (car args) #t (list 'error "assertion failed:" (list 'quote (strip (car args)))))
                                env))
          ((delay-force) (sch-expand (list '%make-lazy-promise (list 'lambda '() (car args))) env))
          ((lambda) (expand-lambda (car args) (cdr args) env))
          ((begin) (if (null? args) '(prim %unspecified)
                       (cons 'seq (map (lambda (e) (sch-expand e env)) args))))
          ((let) (if (and (pair? args) (symbol? (car args)))
                     (expand-named-let (car args) (cadr args) (cddr args) env)
                     (expand-let (car args) (cdr args) env)))
          ((let*) (sch-expand (if (or (null? (car args)) (null? (cdar args)))
                              (cons 'let args)
                              (list 'let (list (caar args)) (cons 'let* (cons (cdar args) (cdr args)))))
                          env))
          ((letrec letrec*) (expand-letrec (car args) (cdr args) env))
          ((cond) (sch-expand (expand-cond args) env))
          ((case) (sch-expand (expand-case args) env))
          ((and) (sch-expand (cond ((null? args) #t)
                               ((null? (cdr args)) (car args))
                               (else (list 'if (car args) (cons 'and (cdr args)) #f)))
                         env))
          ((or) (sch-expand (cond ((null? args) #f)
                              ((null? (cdr args)) (car args))
                              (else (let ((t (gensym-name "or")))
                                      (list 'let (list (list t (car args)))
                                            (list 'if t t (cons 'or (cdr args)))))))
                        env))
          ((when) (sch-expand (list 'if (car args) (cons 'begin (cdr args))) env))
          ((unless) (sch-expand (list 'if (car args) '(begin) (cons 'begin (cdr args))) env))
          ((do) (sch-expand (expand-do args) env))
          ((time) (sch-expand (list '%time-it (list 'lambda '() (car args))) env))
          ((delay) (sch-expand (list '%make-promise (list 'lambda '() (car args))) env))
          (else (expand-application head args env))))
     (else (expand-application head args env)))))

(define *gensym-counter* 0)
(define (gensym-name base)
  (set! *gensym-counter* (+ *gensym-counter* 1))
  (string->symbol (string-append " " base (number->string *gensym-counter*))))

(define (expand-application head args env)
  (cond ((and (primitive? head env)
              (let ((n (cdr (assq (global-name head) *primitives*)))) (or (not n) (= n (length args)))))
         (cons 'prim (cons (global-name head) (map (lambda (e) (sch-expand e env)) args))))
        ((and (symbol? head) (not (lookup head env)) (cxr? (global-name head)) (= (length args) 1))
         ;; cadr -> (car (cdr x))
         (let* ((s (symbol->string (global-name head))) (n (string-length s)))
           (let loop ((i (- n 2)) (e (sch-expand (car args) env)))
             (if (= i 0) e
                 (loop (- i 1) (list 'prim (if (char=? (string-ref s i) #\a) 'car 'cdr) e))))))
        (else (cons 'call (cons (sch-expand head env) (map (lambda (e) (sch-expand e env)) args))))))

;;; (lambda (a b . c) body ...)
(define (expand-lambda params body env)
  (let loop ((p params) (req '()))
    (cond ((null? p) (make-lambda (reverse req) #f body env))
          ((symbol? p) (make-lambda (reverse req) p body env))
          (else (loop (cdr p) (cons (car p) req))))))

(define (make-lambda req rest body env)
  (let* ((rvars (map make-var req))
         (restvar (and rest (make-var rest)))
         (env2 (append (map cons req rvars)
                       (if rest (list (cons rest restvar)) '())
                       env)))
    (list 'lambda rvars restvar (expand-body body env2))))

;;; A body: internal definitions first (letrec*), then expressions
(define (expand-body body env)
  (let* ((s (scan-definitions body env)) (defs (car s)) (forms (cadr s)) (env (caddr s)))
    (if (null? defs)
        (expand-sequence forms env)
        (expand-letrec defs forms env))))

(define (expand-sequence forms env)
  (cond ((null? forms) '(prim %unspecified))
        ((null? (cdr forms)) (sch-expand (car forms) env))
        (else (cons 'seq (map (lambda (e) (sch-expand e env)) forms)))))

;;; (define (f . args) body) -> (f (lambda args body)); curried too
(define (normalize-define d)
  (let ((target (cadr d)))
    (if (pair? target)
        (normalize-define (list 'define (car target) (cons 'lambda (cons (cdr target) (cddr d)))))
        (list target (if (pair? (cddr d)) (caddr d) '(begin))))))

(define (expand-let bindings body env)
  (let* ((names (map car bindings))
         (vars (map make-var names))
         (inits (map (lambda (b) (sch-expand (cadr b) env)) bindings))
         (env2 (append (map cons names vars) env)))
    (list 'let (map list vars inits) (expand-body body env2))))

(define (expand-letrec bindings body env)
  (let* ((names (map car bindings))
         (vars (map make-var names))
         (env2 (append (map cons names vars) env))
         (inits (map (lambda (b) (sch-expand (cadr b) env2)) bindings)))
    (list 'letrec (map list vars inits) (expand-body body env2))))

(define (expand-named-let name bindings body env)
  ;; the loop applied to the initial values
  (sch-expand (cons (list 'letrec (list (list name (cons 'lambda (cons (map car bindings) body)))) name)
                (map cadr bindings))
          env))

(define (expand-cond clauses)
  (if (null? clauses) '(begin)
      (let ((c (car clauses)) (rest (cdr clauses)))
        (cond ((kw? (car c) 'else) (cons 'begin (cdr c)))
              ((and (pair? (cdr c)) (kw? (cadr c) '=>))
               (let ((t (gensym-name "cond")))
                 (list 'let (list (list t (car c)))
                       (list 'if t (list (caddr c) t) (expand-cond rest)))))
              ((null? (cdr c))
               (list 'or (car c) (expand-cond rest)))
              (else (list 'if (car c) (cons 'begin (cdr c)) (expand-cond rest)))))))

(define (expand-case args)
  ;; symbols, booleans, () and small integers compare with eq?; others with eqv?
  (define (test t k)
    (list (if (or (symbol? k) (boolean? k) (null? k)
                  (and (integer? k) (exact? k) (< (abs k) 1000000000)))
              'eq? '%eqv?)
          t (list 'quote k)))
  (define (body t c)   ; (k ...) => proc, or the expressions
    (if (and (pair? (cdr c)) (kw? (cadr c) '=>))
        (list (caddr c) t)
        (cons 'begin (cdr c))))
  (let ((t (gensym-name "case")))
    (list 'let (list (list t (car args)))
          (let loop ((clauses (cdr args)))
            (if (null? clauses) '(begin)
                (let ((c (car clauses)))
                  (if (kw? (car c) 'else)
                      (body t c)
                      (list 'if (cons 'or (map (lambda (k) (test t k)) (car c)))
                            (body t c)
                            (loop (cdr clauses))))))))))

;;; (do ((var init step) ...) (test res ...) body ...)
(define (expand-do args)
  (let ((loop (gensym-name "do")) (specs (car args)) (test (cadr args)) (body (cddr args)))
    (list 'let loop (map (lambda (s) (list (car s) (cadr s))) specs)
          (list 'if (car test)
                (cons 'begin (cdr test))
                (cons 'begin (append body
                                     (list (cons loop (map (lambda (s) (if (pair? (cddr s)) (caddr s) (car s)))
                                                           specs)))))))))

(define (quasi x depth)
  (cond ((not (pair? x)) (if (vector? x)
                             (list 'list->vector (quasi (vector->list x) depth))
                             (list 'quote x)))
        ((kw? (car x) 'unquote)
         (if (= depth 1) (cadr x) (list 'list ''unquote (quasi (cadr x) (- depth 1)))))
        ((kw? (car x) 'quasiquote)
         (list 'list ''quasiquote (quasi (cadr x) (+ depth 1))))
        ((and (pair? (car x)) (kw? (caar x) 'unquote-splicing) (= depth 1))
         (list 'append (cadar x) (quasi (cdr x) depth)))
        (else (list 'cons (quasi (car x) depth) (quasi (cdr x) depth)))))

;;; ------------------------------------------------------------------
;;; Macros: syntax-rules, hygienic by renaming
;;; ------------------------------------------------------------------
;;; A symbol a template brings in is renamed to an alias, fresh at each
;;; use of the macro.  An alias bound by the expansion (a let or lambda
;;; variable) is a variable of its own; a free alias means what its
;;; symbol means where the macro was defined.  So a macro's temporaries
;;; cannot capture the user's variables, and a user's variable cannot
;;; capture the macro's free names.
;;;
;;; An environment maps a symbol to a variable (a vector, make-var) or to
;;; (macro . #(literals ellipsis rules env)).

(define *macros* '())            ; global: (symbol . #(literals ellipsis rules env))
(define *aliases* (table))       ; alias -> (symbol . environment of the macro)
(define *alias-counter* 0)

(define (make-alias sym env)
  (set! *alias-counter* (+ *alias-counter* 1))
  (let ((a (string->symbol (string-append (symbol->string sym) "\x2032;" (number->string *alias-counter*)))))
    (put! *aliases* a (cons sym env))
    a))
(define (alias-info s) (and (symbol? s) (get *aliases* s #f)))

;;; The symbol an alias stands for (a symbol stands for itself)
(define (global-name s) (let ((i (alias-info s))) (if i (global-name (car i)) s)))

;;; Quoted data lose their aliases
(define (strip x)
  (cond ((symbol? x) (global-name x))
        ((pair? x) (cons (strip (car x)) (strip (cdr x))))
        ((vector? x) (list->vector (map strip (vector->list x))))
        (else x)))

;;; The binding of SYM in ENV: a variable, (macro . m), or #f (global)
(define (lookup sym env)
  (let ((b (assq sym env)))
    (if b (cdr b)
        (let ((i (alias-info sym)))
          (if i (lookup (car i) (cdr i))
              (let ((m (assq sym *macros*)))
                (and m (cons 'macro (cdr m)))))))))

(define (macro-binding? b) (and (pair? b) (eq? (car b) 'macro)))

;;; SYM, unbound in ENV, is the keyword KEY (else, =>, define ...)
(define (keyword? sym env key)
  (and (symbol? sym) (not (lookup sym env)) (eq? (global-name sym) key)))
(define (kw? sym key) (and (symbol? sym) (eq? (global-name sym) key)))

;;; (syntax-rules (literal ...) (pattern template) ...), or with an
;;; ellipsis of its own: (syntax-rules ellipsis (literal ...) rule ...)
(define (make-syntax-rules spec env)
  (if (not (and (pair? spec) (kw? (car spec) 'syntax-rules)))
      (syntax-error "only syntax-rules transformers are supported" spec)
      (let* ((custom (symbol? (cadr spec)))
             (ellipsis (if custom (cadr spec) '...))
             (literals (if custom (caddr spec) (cadr spec)))
             (rules (if custom (cdddr spec) (cddr spec))))
        (vector literals ellipsis rules env))))

(define *seq-tag* (list 'seq))   ; marks the values of a pattern variable under an ellipsis
(define (seq? x) (and (pair? x) (eq? (car x) *seq-tag*)))

(define (apply-macro m form)
  (let ((literals (vector-ref m 0)) (ell (vector-ref m 1)) (env (vector-ref m 3)))
    (let loop ((rules (vector-ref m 2)))
      (if (null? rules)
          (syntax-error "no syntax-rules pattern matches" (strip form))
          (let ((b (sr-match (cdar (car rules)) (cdr form) literals ell (list (cons *seq-tag* #t)))))
            (if b
                (sr-expand (cadr (car rules)) b ell env (list '()))
                (loop (cdr rules))))))))

(define (proper-length l) (let loop ((l l) (n 0)) (if (pair? l) (loop (cdr l) (+ n 1)) n)))

;;; Bindings of the pattern variables, or #f
(define (sr-match pat form lits ell b)
  (cond ((not b) #f)
        ((symbol? pat)
         (cond ((memq pat lits) (and (symbol? form) (eq? (global-name form) (global-name pat)) b))
               ((eq? (global-name pat) '_) b)
               (else (cons (cons pat form) b))))
        ((and (pair? pat) (pair? (cdr pat)) (eq? (cadr pat) ell))
         (let* ((tail (cddr pat))
                (n (- (proper-length form) (proper-length tail))))
           (and (>= n 0)
                (let collect ((f form) (k n) (items '()))
                  (if (> k 0)
                      (collect (cdr f) (- k 1) (cons (car f) items))
                      (let ((ms (map (lambda (x) (sr-match (car pat) x lits ell (list (cons *seq-tag* #t))))
                                     (reverse items))))
                        (and (not (memq #f ms))
                             (sr-match tail f lits ell
                                       (append (map (lambda (v)
                                                      (cons v (cons *seq-tag*
                                                                    (map (lambda (m) (cdr (assq v m))) ms))))
                                                    (pattern-vars (car pat) lits ell))
                                               b)))))))))
        ((pair? pat)
         (and (pair? form)
              (sr-match (cdr pat) (cdr form) lits ell (sr-match (car pat) (car form) lits ell b))))
        ((null? pat) (and (null? form) b))
        ((vector? pat) (and (vector? form) (sr-match (vector->list pat) (vector->list form) lits ell b)))
        (else (and (equal? pat form) b))))

(define (pattern-vars pat lits ell)
  (cond ((symbol? pat) (if (or (memq pat lits) (eq? pat ell) (eq? (global-name pat) '_)) '() (list pat)))
        ((pair? pat) (append (pattern-vars (car pat) lits ell) (pattern-vars (cdr pat) lits ell)))
        ((vector? pat) (pattern-vars (vector->list pat) lits ell))
        (else '())))

;;; The template with the bindings; RENAMED: a box of (symbol . alias)
(define (sr-expand t b ell env renamed)
  (cond ((symbol? t)
         (let ((v (assq t b)))
           (cond ((and v (seq? (cdr v))) (syntax-error "pattern variable used without ellipsis" t))
                 (v (cdr v))
                 (else (let ((r (assq t (car renamed))))
                         (if r (cdr r)
                             (let ((a (make-alias t env)))
                               (set-car! renamed (cons (cons t a) (car renamed)))
                               a)))))))
        ((and (pair? t) (eq? (car t) ell) (pair? (cdr t)))   ; (... template): no ellipsis inside
         (sr-expand (cadr t) b (list 'no-ellipsis) env renamed))
        ((and (pair? t) (pair? (cdr t)) (eq? (cadr t) ell))
         (let* ((sub (car t))
                (rest (let skip ((r (cddr t)) (extra 0))   ; t ... ... flattens
                        (if (and (pair? r) (eq? (car r) ell)) (skip (cdr r) (+ extra 1)) (cons extra r))))
                (vars (filter (lambda (v) (let ((x (assq v b))) (and x (seq? (cdr x)))))
                              (template-symbols sub)))
                (items (if (null? vars)
                           (syntax-error "no pattern variable under the ellipsis" (strip t))
                           (let each ((seqs (map (lambda (v) (cddr (assq v b))) vars)) (acc '()))
                             (if (memq '() seqs)
                                 (reverse acc)
                                 (each (map cdr seqs)
                                       (cons (sr-expand sub (append (map (lambda (v s) (cons v (car s))) vars seqs) b)
                                                        ell env renamed)
                                             acc))))))
                (items (let flat ((k (car rest)) (items items))
                         (if (= k 0) items (flat (- k 1) (apply append items))))))
           (append items (sr-expand (cdr rest) b ell env renamed))))
        ((pair? t) (cons (sr-expand (car t) b ell env renamed) (sr-expand (cdr t) b ell env renamed)))
        ((vector? t) (list->vector (sr-expand (vector->list t) b ell env renamed)))
        (else t)))

(define (template-symbols t)
  (cond ((symbol? t) (list t))
        ((pair? t) (append (template-symbols (car t)) (template-symbols (cdr t))))
        ((vector? t) (template-symbols (vector->list t)))
        (else '())))

;;; (let-syntax ((name transformer) ...) body ...); letrec-syntax too
(define (expand-let-syntax bindings body env)
  (let* ((ms (map (lambda (b) (make-syntax-rules (cadr b) env)) bindings))
         (env2 (append (map (lambda (b m) (cons (car b) (cons 'macro m))) bindings ms) env)))
    (for-each (lambda (m) (vector-set! m 3 env2)) ms)
    (expand-body body env2)))

;;; ------------------------------------------------------------------
;;; Definitions: define, define-values, define-record-type, define-syntax
;;; ------------------------------------------------------------------
;;; A definition becomes a list of (name expression) pairs.

(define (definition-head form env)
  "The kind of definition FORM is, or #f."
  (and (pair? form) (symbol? (car form)) (not (lookup (car form) env))
       (memq (global-name (car form)) '(define define-values define-record-type define-syntax begin cond-expand))
       (global-name (car form))))

(define (expand-define-values formals expr)
  (let* ((names (let loop ((f formals) (acc '()))
                  (cond ((pair? f) (loop (cdr f) (cons (car f) acc)))
                        ((symbol? f) (reverse (cons f acc)))
                        (else (reverse acc)))))
         (temps (map (lambda (n) (gensym-name "v")) names))
         (tformals (let loop ((f formals) (ts temps))
                     (cond ((pair? f) (cons (car ts) (loop (cdr f) (cdr ts))))
                           ((symbol? f) (car ts))
                           (else '())))))
    (append (map (lambda (n) (list n #f)) names)
            (list (list (gensym-name "dv")
                        (list 'call-with-values (list 'lambda '() expr)
                              (list 'lambda tformals
                                    (cons 'begin (map (lambda (n t) (list 'set! n t)) names temps)))))))))

;;; (define-record-type name (constructor field ...) predicate (field accessor [modifier]) ...)
(define (expand-define-record-type spec)
  (let* ((tname (if (pair? (cadr spec)) (car (cadr spec)) (cadr spec)))
         (ctor (caddr spec)) (pred (cadddr spec)) (fspecs (cdr (cdddr spec)))
         (fields (map (lambda (f) (if (pair? f) (car f) f)) fspecs))
         (index (lambda (f) (let loop ((fs fields) (i 0))
                              (cond ((null? fs) (syntax-error "not a field of the record type" f))
                                    ((eq? (car fs) f) i)
                                    (else (loop (cdr fs) (+ i 1)))))))
         (obj (gensym-name "obj")) (val (gensym-name "val"))
         (check (lambda (who) (list 'if (list '%record-of? obj tname) #f (list '%record-error obj (list 'quote who))))))
    (append
     (list (list tname (list '%make-record-type (list 'quote (strip tname)) (list 'quote (map strip fields)))))
     (if (and ctor (not (eq? ctor #t)))
         (let ((cname (if (pair? ctor) (car ctor) ctor))
               (cfields (if (pair? ctor) (cdr ctor) fields)))
           (list (list cname
                       (list 'lambda cfields
                             (list '%make-record tname
                                   (cons 'vector (map (lambda (f) (if (memq f cfields) f #f)) fields)))))))
         '())
     (if pred (list (list pred (list 'lambda (list obj) (list '%record-of? obj tname)))) '())
     (apply append
            (map (lambda (f)
                   (if (not (pair? f)) '()
                       (let ((i (index (car f))))
                         (append
                          (if (pair? (cdr f))
                              (list (list (cadr f)
                                          (list 'lambda (list obj) (check (cadr f))
                                                (list 'vector-ref (list '%record-fields obj) i))))
                              '())
                          (if (and (pair? (cdr f)) (pair? (cddr f)))
                              (list (list (caddr f)
                                          (list 'lambda (list obj val) (check (caddr f))
                                                (list 'vector-set! (list '%record-fields obj) i val))))
                              '())))))
                 fspecs)))))

;;; The definitions at the start of FORMS (macros used there expanded):
;;; (bindings rest-forms env), ENV extended by internal define-syntax.
;;; Expressions between definitions become bindings of unused variables.
(define (scan-definitions forms env)
  (let loop ((fs forms) (defs '()) (pending '()) (env env))
    (if (null? fs)
        (list (reverse defs) (reverse pending) env)
        (let* ((f (car fs)) (kind (definition-head f env)))
          (cond ((and (pair? f) (symbol? (car f)) (macro-binding? (lookup (car f) env)))
                 (loop (cons (apply-macro (cdr (lookup (car f) env)) f) (cdr fs)) defs pending env))
                ((eq? kind 'begin) (loop (append (cdr f) (cdr fs)) defs pending env))
                ((eq? kind 'cond-expand) (loop (append (cond-expand-forms (cdr f)) (cdr fs)) defs pending env))
                ((not kind) (loop (cdr fs) defs (cons f pending) env))
                (else
                 ;; a definition after expressions: they become bindings too
                 (let ((defs (append (map (lambda (e) (list (gensym-name "e") e)) (reverse pending)) defs)))
                   (case kind
                     ((define) (loop (cdr fs) (cons (normalize-define f) defs) '() env))
                     ((define-values) (loop (cdr fs) (append (reverse (expand-define-values (cadr f) (caddr f))) defs) '() env))
                     ((define-record-type) (loop (cdr fs) (append (reverse (expand-define-record-type f)) defs) '() env))
                     ((define-syntax)
                      (let ((m (make-syntax-rules (caddr f) #f)))
                        (let ((env2 (cons (cons (cadr f) (cons 'macro m)) env)))
                          (vector-set! m 3 env2)
                          (loop (cdr fs) defs '() env2))))))))))))

;;; ------------------------------------------------------------------
;;; A program: top-level forms
;;; ------------------------------------------------------------------

(define (expand-toplevel forms)
  "The core forms of the top-level FORMS: (gdef sym e) or expressions."
  (let loop ((fs forms) (acc '()))
    (if (null? fs) (reverse acc)
        (let* ((f (car fs)) (kind (definition-head f '())))
          (cond ((and (pair? f) (symbol? (car f)) (macro-binding? (lookup (car f) '())))
                 (loop (cons (apply-macro (cdr (lookup (car f) '())) f) (cdr fs)) acc))
                ((eq? kind 'begin) (loop (append (cdr f) (cdr fs)) acc))
                ((eq? kind 'cond-expand) (loop (append (cond-expand-forms (cdr f)) (cdr fs)) acc))
                ((eq? kind 'define-syntax)
                 (set! *macros* (cons (cons (global-name (cadr f)) (make-syntax-rules (caddr f) '())) *macros*))
                 (loop (cdr fs) acc))
                (kind
                 (let ((ds (case kind
                             ((define) (list (normalize-define f)))
                             ((define-values) (expand-define-values (cadr f) (caddr f)))
                             (else (expand-define-record-type f)))))
                   (loop (cdr fs)
                         (append (reverse (map (lambda (d) (list 'gdef (global-name (car d)) (sch-expand (cadr d) '())))
                                               ds))
                                 acc))))
                (else (loop (cdr fs) (cons (sch-expand f '()) acc))))))))

;;; ------------------------------------------------------------------
;;; More derived forms
;;; ------------------------------------------------------------------

;;; (let-values (((a b . c) expr) ...) body): the values in temporaries first
(define (expand-let-values bindings body)
  (let* ((renames '())
         (rename (lambda (formals)
                   (let loop ((f formals))
                     (cond ((pair? f) (let ((t (gensym-name "lv")))
                                        (set! renames (cons (list (car f) t) renames))
                                        (cons t (loop (cdr f)))))
                           ((symbol? f) (let ((t (gensym-name "lv")))
                                          (set! renames (cons (list f t) renames))
                                          t))
                           (else '())))))
         (tformals (map (lambda (b) (rename (car b))) bindings)))
    (let loop ((bs bindings) (ts tformals))
      (if (null? bs)
          (cons 'let (cons (reverse renames) body))
          (list 'call-with-values (list 'lambda '() (cadar bs))
                (list 'lambda (car ts) (loop (cdr bs) (cdr ts))))))))

(define (expand-let*-values bindings body)
  (if (null? bindings)
      (cons 'let (cons '() body))
      (list 'call-with-values (list 'lambda '() (cadar bindings))
            (list 'lambda (caar bindings) (expand-let*-values (cdr bindings) body)))))

;;; (case-lambda (formals body ...) ...)
(define (expand-case-lambda clauses)
  (let ((args (gensym-name "args")) (n (gensym-name "n")))
    (list 'lambda args
          (list 'let (list (list n (list 'length args)))
                (cons 'cond
                      (append (map (lambda (c)
                                     (list (list (if (list? (car c)) '= '>=) n (proper-length (car c)))
                                           (list 'apply (cons 'lambda c) args)))
                                   clauses)
                              (list (list 'else (list 'error "case-lambda: no clause takes this many arguments:" n)))))))))

;;; (guard (var clause ...) body ...)
(define (expand-guard spec body)
  (let ((k (gensym-name "k")) (c (gensym-name "c")) (vals (gensym-name "vals"))
        (clauses (cdr spec)))
    (list (list 'call-with-current-continuation
                (list 'lambda (list k)
                      (list 'with-exception-handler
                            (list 'lambda (list c)
                                  (list k (list 'lambda '()
                                                (list 'let (list (list (car spec) c))
                                                      (cons 'cond
                                                            (if (and (pair? clauses) (kw? (car (car (last-pair clauses))) 'else))
                                                                clauses
                                                                (append clauses
                                                                        (list (list 'else (list 'raise-continuable c))))))))))
                            (list 'lambda '()
                                  (list 'call-with-values (cons 'lambda (cons '() body))
                                        (list 'lambda vals
                                              (list k (list 'lambda '() (list 'apply 'values vals))))))))))))

;;; (cond-expand (requirement form ...) ...): the forms of the first clause met
(define *features* '(r7rs full-unicode schemer wasm))
(define (feature? req)
  (cond ((symbol? req) (or (kw? req 'else) (memq (global-name req) *features*)))
        ((kw? (car req) 'and) (let loop ((l (cdr req))) (or (null? l) (and (feature? (car l)) (loop (cdr l))))))
        ((kw? (car req) 'or) (let loop ((l (cdr req))) (and (pair? l) (or (feature? (car l)) (loop (cdr l))))))
        ((kw? (car req) 'not) (not (feature? (cadr req))))
        ((kw? (car req) 'library) (memq (global-name (car (cadr req))) '(scheme)))
        (else #f)))
(define (cond-expand-forms clauses)
  (cond ((null? clauses) '())
        ((feature? (caar clauses)) (cdar clauses))
        (else (cond-expand-forms (cdr clauses)))))
