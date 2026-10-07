fn main() {
    // The web player (npm run web:build) is optional: without it the app builds, and Web export says how to get it.
    let wasm = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../native/target/wasm32-wasip1/release/slate-player.wasm");
    println!("cargo:rerun-if-changed={}", wasm.display());
    let path = if wasm.exists() {
        wasm
    } else {
        let empty = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("no-web-player.wasm");
        std::fs::write(&empty, b"").unwrap();
        empty
    };
    println!("cargo:rustc-env=SLATE_WEB_WASM={}", path.display());
    tauri_build::build()
}
