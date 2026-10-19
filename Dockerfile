# CashTrack IoT backend (withdrawal co-signing service). No npm dependencies at runtime.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY core/src ./core/src
COPY backend/src ./backend/src
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "backend/src/server.js"]
