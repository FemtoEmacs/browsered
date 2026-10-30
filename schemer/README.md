# Schemer compiler in Browsered

Schemer is the user's Chez-inspired Scheme-to-WasmGC compiler. Its expander,
compiler, linker and prelude were vendored on 2026-10-30.

`web/schemer.js` loads the embedded `compiler.wasm` directly. It creates an
isolated WebAssembly instance per compilation, provides a virtual request file,
and captures emitted module bytes. It never executes the source it compiles.
There is no second FemtoScheme VM, `createFemtoscheme`, or compiler `fs_eval`.
The seed contains its compiler sources and prelude; runtime network requests
are unnecessary. `make` embeds it into the standalone HTML.

The native Schememax sibling builds the same seed using its standalone
Wasmtime driver and `make rebuild-compiler`. Its `make check-selfhost` proves
a byte-identical two-generation rebuild with no interpreter linkage. Keep
compiler-support.scm, compiler-main.scm, wasm.scm, link.scm and prelude.scm
synchronized when updating the shared seed. `tests/schemer-test.js` verifies
the browser compiler path, integer boundaries and actual compiled execution.

`browsered.scm` adapts shared scalar editor globals and editor UTF-8 byte
lengths. `host.js` supplies the browser host imports. `web/schemer.js` retains
compiled procedures and services JSPI callbacks through queued RPC on the
editor stack. The compiler emits WebAssembly, not JavaScript.

The editor core and native terminal test runner still use FemtoScheme.
Legacy macros, shared mutable editor objects, ports and higher-order native
callbacks retain compatibility handlers. Removing the compiler interpreter
does not remove the editor interpreter. See `../RUNTIME-MIGRATION.md`.
