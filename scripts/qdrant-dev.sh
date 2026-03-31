#!/usr/bin/env bash
set -euo pipefail

NAME="${QDRANT_CONTAINER_NAME:-manifold-qdrant}"
HTTP_PORT="${QDRANT_HTTP_PORT:-6333}"
GRPC_PORT="${QDRANT_GRPC_PORT:-6334}"
DATA_DIR="${QDRANT_DATA_DIR:-./qdrant_storage}"
IMAGE="${QDRANT_IMAGE:-qdrant/qdrant:latest}"

cmd="${1:-up}"

print_info() {
  echo "Qdrant running:"
  echo "  Container: ${NAME}"
  echo "  HTTP:      http://127.0.0.1:${HTTP_PORT}"
  echo "  gRPC:      127.0.0.1:${GRPC_PORT}"
  echo "  Data:      ${DATA_DIR}"
  echo ""
  echo "Set in .env.local (for the Tauri app):"
  echo "  MANIFOLD_QDRANT_URL=http://127.0.0.1:${HTTP_PORT}"
}

case "$cmd" in
  up)
    docker pull "$IMAGE"
    if docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
      print_info
      exit 0
    fi

    if docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
      docker start "$NAME" >/dev/null
      print_info
      exit 0
    fi

    docker run -d --name "$NAME" \
      -p "${HTTP_PORT}:6333" -p "${GRPC_PORT}:6334" \
      -v "${DATA_DIR}:/qdrant/storage" \
      "$IMAGE" >/dev/null
    print_info
    ;;
  down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "Stopped container: $NAME"
    ;;
  logs)
    docker logs -f "$NAME"
    ;;
  *)
    echo "Usage: $0 {up|down|logs}"
    exit 1
    ;;
esac

