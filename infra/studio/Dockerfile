FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build

# ffmpeg pinned to the same build on every machine (workstation and all homelab ffmpeg services):
# BtbN n8.1.3-39-g660b5aa7db (GPL, static, NVENC-capable), our checksum-verified copy in RustFS.
# Change it here and in proxmox-home docs/ffmpeg-version-pin.md together.
FROM debian:trixie-slim AS ffmpeg
ARG FFMPEG_BUILD=n8.1.3-39-g660b5aa7db
ARG FFMPEG_SHA256=b1c6934b4c3cbbbc0e0a39671c012437db99b719d8ec640ba3371a5876115d78
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates xz-utils \
	&& curl -fsSL -o /tmp/ffmpeg.tar.xz "https://s3.v1su4.dev/storyception/tools/ffmpeg/${FFMPEG_BUILD}/ffmpeg-${FFMPEG_BUILD}-linux64-gpl-8.1.tar.xz" \
	&& echo "${FFMPEG_SHA256}  /tmp/ffmpeg.tar.xz" | sha256sum -c - \
	&& mkdir /tmp/ffmpeg && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1 \
	&& install -m 755 /tmp/ffmpeg/bin/ffmpeg /tmp/ffmpeg/bin/ffprobe /usr/local/bin/

FROM oven/bun:1.4.4
COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /usr/local/bin/
COPY --from=ffmpeg /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /usr/local/bin/
# DejaVu: the missing-shot text cards (slate.ts) draw with it.
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/* \
	&& ffmpeg -version | head -1 | grep -q "n8.1.3-39-g660b5aa7db"
WORKDIR /app
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/agent-skills ./agent-skills
COPY --from=build /app/.agents/skills ./.agents/skills
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/lib/server/reference-sheet.ts ./src/lib/server/reference-sheet.ts
COPY --from=build /app/src/lib/server/ffmpeg.ts ./src/lib/server/ffmpeg.ts
COPY --from=build /app/src/lib/server/media-probe.ts ./src/lib/server/media-probe.ts
COPY --from=build /app/prompts ./prompts
USER bun
EXPOSE 3000
CMD ["bun", "build/index.js"]
