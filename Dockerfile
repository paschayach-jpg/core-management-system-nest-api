# syntax=docker/dockerfile:1.7
# ── build: คอมไพล์ TypeScript ───────────────────────────────
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ── deps: เฉพาะ dependency สำหรับ production ────────────────
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── runtime: image สุดท้าย (ไม่มี source/devDependency, รันด้วยผู้ใช้ non-root) ──
FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    TZ=Asia/Bangkok \
    PORT=3000
RUN apk add --no-cache tzdata tini \
 && ln -sf /usr/share/zoneinfo/Asia/Bangkok /etc/localtime
WORKDIR /app
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
# ที่เก็บไฟล์ DMS: mount volume/SMB share มาที่ /data (ตั้ง STORAGE_ROOT=/data)
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/live" || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
