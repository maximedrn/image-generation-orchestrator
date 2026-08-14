FROM ubuntu:24.04 AS build
ARG SDCPP_COMMIT=de298c225bed97c3f9026b73cd7b71e7879bd41b
ARG BUILD_JOBS=2
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential ca-certificates cmake git \
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
  && cmake --build build --config Release --parallel "${BUILD_JOBS}"

FROM ubuntu:24.04 AS runtime
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates curl libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 engine
COPY --from=build /src/build/bin/sd-server /usr/local/bin/sd-server
COPY --chmod=0555 docker/engine-healthcheck.sh /usr/local/bin/engine-healthcheck
COPY --chmod=0555 docker/engine-entrypoint.sh /usr/local/bin/engine-entrypoint
USER engine
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/engine-entrypoint"]
