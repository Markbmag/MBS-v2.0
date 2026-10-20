# Ncode web: the built frontend served by Caddy, which also forwards /api to the backend and does HTTPS.
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# empty: the API is the same address as the page
ENV VITE_API_URL=""
RUN npm run build

FROM caddy:2.10-alpine
COPY --from=build /src/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
