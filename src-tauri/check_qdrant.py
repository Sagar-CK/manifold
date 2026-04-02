import os
import subprocess
import sys


def check_rust_code(code: str) -> str:
    path = "src/qdrant_test.rs"
    with open(path, "w") as f:
        f.write(code)
    res = subprocess.run(["cargo", "check"], capture_output=True, text=True)
    if res.returncode == 0:
        return "OK"
    return res.stderr


code = """
use qdrant_client::Qdrant;
use qdrant_client::qdrant::*;
use qdrant_client::Payload;

pub async fn test() {
    let client = Qdrant::from_url("http://localhost").build().unwrap();
    let res = client.scroll(ScrollPointsBuilder::new("col").with_vectors(true)).await.unwrap();
    if let Some(point) = res.result.into_iter().next() {
        let v = point.vectors;
        let p = point.payload;
    }
}
"""

print(check_rust_code(code))
