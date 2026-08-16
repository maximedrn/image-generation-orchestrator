# syntax=docker/dockerfile:1.19
# Single parameterised build for every stable-diffusion.cpp hardware backend.
# Each Compose profile supplies the base images, the extra packages and the
# cmake flag that its accelerator needs; nothing else differs between backends.
ARG BUILD_IMAGE=ubuntu:26.04
ARG RUNTIME_IMAGE=ubuntu:26.04

FROM ${BUILD_IMAGE} AS build

ARG SDCPP_COMMIT=de298c225bed97c3f9026b73cd7b71e7879bd41b
# Empty means "every core the builder has". Set it to cap parallelism on a
# machine that has to stay responsive during the compile.
ARG BUILD_JOBS=""
ARG BUILD_PACKAGES=""
ARG SD_CMAKE_FLAGS=""

# Keeping the downloaded archives lets the cache mount serve the next build.
# Mounts never become layers, so the image stays the same size either way.
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
  && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' \
    > /etc/apt/apt.conf.d/keep-downloads

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential ca-certificates ccache cmake git ninja-build ${BUILD_PACKAGES}

WORKDIR /src

# Fetching the single pinned commit avoids cloning the full history and every
# submodule revision leading up to it.
RUN git init --quiet . \
  && git remote add origin https://github.com/leejet/stable-diffusion.cpp.git \
  && git fetch --quiet --depth 1 --filter=blob:none origin "${SDCPP_COMMIT}" \
  && git checkout --quiet FETCH_HEAD \
  && git submodule update --init --recursive --depth 1

# ccache makes a commit bump, or a second backend built on the same machine,
# a mostly cached compile instead of a full one.
RUN --mount=type=cache,target=/root/.cache/ccache,sharing=locked \
  cmake -S . -B build -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER_LAUNCHER=ccache \
    -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    -DSD_BUILD_SHARED_LIBS=OFF \
    -DSD_BUILD_SHARED_GGML_LIB=OFF \
    -DGGML_NATIVE=OFF \
    ${SD_CMAKE_FLAGS} \
  && cmake --build build --config Release \
    --parallel "${BUILD_JOBS:-$(nproc)}" \
  && ccache --show-stats

FROM ${RUNTIME_IMAGE} AS runtime

ARG RUNTIME_PACKAGES="libgomp1"

RUN rm -f /etc/apt/apt.conf.d/docker-clean \
  && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' \
    > /etc/apt/apt.conf.d/keep-downloads

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl ${RUNTIME_PACKAGES} \
  && useradd --create-home --uid 10001 engine \
  && mkdir -p /var/lib/sd-server \
  && chown engine:engine /var/lib/sd-server

COPY --from=build /src/build/bin/sd-server /usr/local/bin/sd-server

# sd-server scans its working directory for LoRAs and embeddings when
# --lora-model-dir and --embd-dir are left unset. Started from `/`, that walk
# reaches /proc/1/map_files, which cap_drop: ALL forbids, and every request
# then fails with a filesystem error. An empty working directory keeps the
# scan harmless without depending on a flag an operator could drop.
WORKDIR /var/lib/sd-server

USER engine

EXPOSE 8080

ENTRYPOINT ["sd-server"]
