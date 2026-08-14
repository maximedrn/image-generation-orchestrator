#!/usr/bin/env sh
set -eu

run_backend() {
  backend="$1"
  shift
  export ENGINE_BACKEND="${backend}"
  case "${backend}" in
    cpu|cuda|rocm|vulkan)
      exec docker compose --profile "${backend}" up --build "$@"
      ;;
    external)
      exec docker compose up --build "$@"
      ;;
    *)
      printf '%s\n' "unsupported ENGINE_BACKEND: ${backend}" >&2
      exit 64
      ;;
  esac
}

if [ -n "${ENGINE_BACKEND:-}" ]; then
  backend_override="${ENGINE_BACKEND}"
  run_backend "${backend_override}" "$@"
fi

if [ "$(uname -s)" = "Darwin" ]; then
  run_backend external "$@"
fi

if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  run_backend cuda "$@"
fi

if [ -e /dev/kfd ]; then
  run_backend rocm "$@"
fi

if [ -d /dev/dri ]; then
  run_backend vulkan "$@"
fi

run_backend cpu "$@"
