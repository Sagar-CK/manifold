use std::path::{Path, PathBuf};

fn copy_pdfium_into_resources() {
    let manifest_dir = match std::env::var("CARGO_MANIFEST_DIR") {
        Ok(v) => PathBuf::from(v),
        Err(_) => return,
    };

    let resources_dir = manifest_dir.join("resources");
    let target_lib = resources_dir.join("libpdfium.dylib");
    let _ = std::fs::create_dir_all(&resources_dir);

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(raw) = std::env::var("MANIFOLD_PDFIUM_LIB_PATH") {
        let p = PathBuf::from(raw.trim());
        if p.is_file() {
            candidates.push(p);
        } else if p.is_dir() {
            candidates.push(p.join("libpdfium.dylib"));
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/lib/libpdfium.dylib"));
    candidates.push(PathBuf::from("/usr/local/lib/libpdfium.dylib"));

    for candidate in candidates {
        if candidate.is_file() {
            if same_file(&candidate, &target_lib) {
                return;
            }
            if std::fs::copy(&candidate, &target_lib).is_ok() {
                println!("cargo:warning=Copied Pdfium from {}", candidate.display());
                return;
            }
        }
    }

    println!(
        "cargo:warning=Pdfium library not found; PDF thumbnails need resources/libpdfium.dylib or MANIFOLD_PDFIUM_LIB_PATH"
    );
}

fn same_file(a: &Path, b: &Path) -> bool {
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

fn main() {
    copy_pdfium_into_resources();
    tauri_build::build()
}
