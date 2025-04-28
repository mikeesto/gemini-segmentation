FROM node:lts-slim AS builder
WORKDIR /app
COPY package*.json .
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

FROM node:lts-slim
WORKDIR /app

RUN apt-get update && \
  apt-get install -y imagemagick --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/build build/
COPY --from=builder /app/node_modules node_modules/
COPY package.json .

EXPOSE 3000
CMD [ "node", "build" ]