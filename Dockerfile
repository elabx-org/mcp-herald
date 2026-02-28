FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ dist/

# Runtime env vars (set at deploy time)
ENV HERALD_URL="http://herald:8765"
ENV HERALD_API_TOKEN=""
ENV MCP_TRANSPORT="stdio"
ENV MCP_HOST="0.0.0.0"
ENV MCP_PORT="8000"

EXPOSE 8000

ENTRYPOINT ["node", "dist/index.js"]
