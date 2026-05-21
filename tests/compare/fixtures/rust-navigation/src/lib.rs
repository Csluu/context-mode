pub mod worker;

pub use worker::{build_worker, Worker};

pub fn dispatch_worker(name: String) -> Worker {
    build_worker(name)
}
