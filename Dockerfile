# DocuAI: one deployable origin for React, Express, SQLite, and FFmpeg.
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-bookworm-slim AS backend-builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/src/ ./src/

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg dumb-init ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --from=backend-builder /app/backend/ ./
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/
ENV NODE_ENV=production HOST=0.0.0.0
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/server.js"]
