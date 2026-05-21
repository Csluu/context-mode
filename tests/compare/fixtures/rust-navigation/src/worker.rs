// This fixture intentionally has enough non-symbol context to behave like a
// normal Rust source file instead of a toy four-line benchmark. The static
// navigator should return small symbol slices and outlines instead of making
// agents reread the full file for each navigation step.
//
// Worker models the kind of compact domain object agents commonly inspect
// during bug hunts: one public struct, a small impl block, a constructor, a
// formatter, and a factory function re-exported by lib.rs. Keeping the extra
// context outside the target symbol bodies lets the cost profile validate the
// practical win from symbol reads over repeated full-file reads.
//
// The comments here are deliberately plain text. They should not become
// symbols, imports, likely tests, or reference hits, but they do represent
// bytes that raw file-reading workflows would repeatedly move through the
// model context.
//
// Navigation scenarios covered:
// - file outline for src/worker.rs
// - find_symbol for build_worker, Worker, and Worker.new
// - read_symbol for the exact function, struct, and method ranges
// - refs_light for textual usages in lib.rs and tests/worker_test.rs
// - related_files from Rust `mod worker;`
// - likely_tests matching tests/worker_test.rs

pub struct Worker {
    name: String,
}

impl Worker {
    pub fn new(name: String) -> Self {
        Self { name }
    }

    pub fn render(&self) -> String {
        format!("worker:{}", self.name)
    }
}

pub fn build_worker(name: String) -> Worker {
    Worker::new(name)
}
