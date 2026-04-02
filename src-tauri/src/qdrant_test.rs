
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
