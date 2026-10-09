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

    // The native players to export games with. This OS's own build is used by default; players for
    // the other systems come from CI (SLATE_PLAYER_WINDOWS / _MACOS / _LINUX = file paths).
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let release = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../native/target/release");
    let host = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    for (os, exe) in [("windows", "slate-player.exe"), ("macos", "slate-player"), ("linux", "slate-player")] {
        let var = format!("SLATE_PLAYER_{}", os.to_uppercase());
        println!("cargo:rerun-if-env-changed={var}");
        let given = std::env::var(&var).ok().map(std::path::PathBuf::from).filter(|p| p.exists());
        let local = (host == os).then(|| release.join(exe)).filter(|p| p.exists());
        let path = given.or(local).unwrap_or_else(|| {
            let empty = out.join(format!("no-{os}-player"));
            std::fs::write(&empty, b"").unwrap();
            empty
        });
        println!("cargo:rerun-if-changed={}", path.display());
        println!("cargo:rustc-env={var}={}", path.display());
    }
    tauri_build::build()
}
