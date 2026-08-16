# Single parameterised build for every stable-diffusion.cpp hardware backend.
# Each Compose profile supplies the base images, the extra packages and the
# cmake flag that its accelerator needs; nothing else differs between backends.
ARG BUILD_IMAGE=ubuntu:26.04
ARG RUNTIME_IMAGE=ubuntu:26.04

FROM ${BUILD_IMAGE} AS build

ARG SDCPP_COMMIT=de298c225bed97c3f9026b73cd7b71e7879bd41b
ARG BUILD_JOBS=2
ARG BUILD_PACKAGES=""
ARG SD_CMAKE_FLAGS=""

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake git ${BUILD_PACKAGES} \
  && rm -rf /var/lib/apt/lists/*

  WORKDIR /src

  RUN git clone --filter=blob:none https://github.com/leejet/stable-diffusion.cpp.git . \
  && git checkout "${SDCPP_COMMIT}" \
  && git submodule update --init --recursive

  RUN cmake -S . -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DSD_BUILD_SHARED_LIBS=OFF \
    -DSD_BUILD_SHARED_GGML_LIB=OFF \
    -DGGML_NATIVE=OFF \
    ${SD_CMAKE_FLAGS} \
  && cmake --build build --config Release --parallel "${BUILD_JOBS}"

FROM ${RUNTIME_IMAGE} AS runtime

ARG RUNTIME_PACKAGES="libgomp1"

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl ${RUNTIME_PACKAGES} \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 engine

COPY --from=build /src/build/bin/sd-server /usr/local/bin/sd-server

USER engine

EXPOSE 8080

ENTRYPOINT ["sd-server"]
