use rust_navigation::build_worker;

#[test]
fn renders_worker() {
    let worker = build_worker("alpha".to_string());
    assert_eq!(worker.render(), "worker:alpha");
}
