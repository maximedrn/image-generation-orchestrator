#!/usr/bin/env sh
set -eu

VAE_TILING_VALUE="${SDCPP_VAE_TILING:-true}"
BACKEND_PLACEMENT_VALUE="${SDCPP_BACKEND_PLACEMENT:-}"
PARAMS_BACKEND_VALUE="${SDCPP_PARAMS_BACKEND:-}"

case "${VAE_TILING_VALUE}" in
  true)
    set -- "$@" --vae-tiling
    ;;
  false)
    ;;
  *)
    printf '%s\n' "SDCPP_VAE_TILING must be 'true' or 'false'" >&2
    exit 64
    ;;
esac

if [ -n "${BACKEND_PLACEMENT_VALUE}" ]; then
  set -- "$@" --backend "${BACKEND_PLACEMENT_VALUE}"
fi

if [ -n "${PARAMS_BACKEND_VALUE}" ]; then
  set -- "$@" --params-backend "${PARAMS_BACKEND_VALUE}"
fi

exec sd-server "$@"
