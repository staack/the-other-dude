FROM golang:1.24-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# GOMAXPROCS=1 limits the Go compiler to one OS thread during the Docker build.
# Without this, go build spawns workers proportional to GOMAXPROCS (defaults to
# the host CPU count), which combined with the parallel Node and Python builds
# can saturate all cores and spike RAM on a 2-core / 2-4 GB server.
RUN CGO_ENABLED=0 GOOS=linux GOMAXPROCS=1 go build -o /poller ./cmd/poller

FROM alpine:3.21
RUN apk add --no-cache ca-certificates iproute2
COPY --from=builder /poller /usr/local/bin/poller
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
