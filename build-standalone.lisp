;;; Build one HTML file from the readable editor sources. No dependencies.
(require :asdf)

(defun read-source (directory name)
  (uiop:read-file-string (merge-pathnames name directory)))

(defun replace-once (text old new)
  (let ((position (search old text)))
    (unless position (error "Missing template fragment: ~A" old))
    (concatenate 'string (subseq text 0 position) new
                 (subseq text (+ position (length old))))))

(defun inline-safe (name text)
  "Text placed inside a <script> element must not close it early."
  (when (search "</script" (string-downcase text))
    (error "~A contains </script and cannot be inlined" name))
  text)

(let* ((directory (make-pathname :name nil :type nil :defaults *load-truename*))
       (html (read-source directory "editor.html")))
  (setf html
        (replace-once html "<link rel=\"stylesheet\" href=\"editor.css\">"
                      (format nil "<style>~%~A~%</style>"
                              (read-source directory "editor.css"))))
  (dolist (name '("keys.js" "femtoscheme/wasm/femtoscheme.js" "scheme.js" "editor.js"))
    (setf html
          (replace-once html (format nil "<script src=\"~A\"></script>" name)
                        (format nil "<script>~%~A~%</script>"
                                (inline-safe name (read-source directory name))))))
  (setf html
        (replace-once html "<script type=\"text/x-scheme\" id=\"browsered-editor-scm\" src=\"editor.scm\"></script>"
                      (format nil "<script type=\"text/x-scheme\" id=\"browsered-editor-scm\">~%~A~%</script>"
                              (inline-safe "editor.scm" (read-source directory "editor.scm")))))
  (with-open-file (output (merge-pathnames "Browsered.html" directory)
                          :direction :output :if-exists :supersede
                          :external-format :utf-8)
    (write-string html output))
  (format t "Built Browsered.html; open it directly in Chrome.~%"))
