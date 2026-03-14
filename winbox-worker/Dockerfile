# Stage 1: Build Go session manager
FROM golang:1.22-bookworm AS builder

WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /winbox-worker ./cmd/worker/

# Stage 2: Runtime with Xpra + WinBox
FROM ubuntu:24.04 AS runtime

ARG WINBOX_VERSION=4.0.1
ARG WINBOX_SHA256=8ec2d08929fd434c4b88881f3354bdf60b057ecd2fb54961dd912df57e326a70

# Install Xpra + X11 deps
# Use distro xpra (works on all architectures including arm64 via emulation)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
        xvfb \
        xpra \
        libjs-jquery \
        libjs-jquery-ui \
        libxcb1 \
        libxcb-icccm4 \
        libxcb-image0 \
        libxcb-keysyms1 \
        libxcb-render-util0 \
        libxcb-cursor0 \
        libxcb-shape0 \
        libx11-6 \
        libx11-xcb1 \
        libxkbcommon0 \
        libxkbcommon-x11-0 \
        libgl1 \
        libgl1-mesa-dri \
        libegl1 \
        libegl-mesa0 \
        libfontconfig1 \
        libdbus-1-3 \
        xauth \
        python3-pil \
    && rm -rf /var/lib/apt/lists/*

# Download and verify WinBox binary
RUN curl -fsSL -o /tmp/WinBox_Linux.zip \
        "https://download.mikrotik.com/routeros/winbox/${WINBOX_VERSION}/WinBox_Linux.zip" \
    && echo "${WINBOX_SHA256}  /tmp/WinBox_Linux.zip" | sha256sum -c - \
    && mkdir -p /opt/winbox \
    && unzip /tmp/WinBox_Linux.zip -d /opt/winbox \
    && chmod +x /opt/winbox/WinBox \
    && rm /tmp/WinBox_Linux.zip

# Patch Xpra HTML5 client: _poll_clipboard is called on every mouse click
# but never checks clipboard_enabled, causing clipboard permission prompts
RUN sed -i 's/XpraClient.prototype._poll_clipboard = function(e) {/XpraClient.prototype._poll_clipboard = function(e) {\n\tif (!this.clipboard_enabled) { return; }/' \
    /usr/share/xpra/www/js/Client.js

# Create non-root user
RUN groupadd --gid 1001 worker && \
    useradd --uid 1001 --gid worker --create-home worker

# Create session directory and XDG runtime dir
RUN mkdir -p /tmp/winbox-sessions && chown worker:worker /tmp/winbox-sessions && \
    mkdir -p /run/user/1001/xpra && chown -R worker:worker /run/user/1001

# Copy Go binary
COPY --from=builder /winbox-worker /usr/local/bin/winbox-worker

USER worker

EXPOSE 9090

ENTRYPOINT ["/usr/local/bin/winbox-worker"]
