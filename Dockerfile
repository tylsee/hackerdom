FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci --include=dev
COPY frontend/ ./
ENV VITE_API_MODE=live VITE_BACKEND_PROFILE=milestone5 VITE_API_BASE_URL=""
RUN npm run build

FROM node:22-bookworm-slim AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY backend/src/ ./src/

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg nginx gettext-base dumb-init ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend
COPY --from=backend-builder /app/backend/ ./
COPY --from=frontend-builder /app/frontend/dist/ /app/frontend/dist/
COPY deployment/ /app/deployment/
RUN sed -i 's/\r$//' /app/deployment/start.sh
ENV NODE_ENV=production HOST=127.0.0.1
EXPOSE 8080
ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "/app/deployment/start.sh"]
