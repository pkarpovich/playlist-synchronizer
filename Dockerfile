ARG NODE_VERSION=22.13

FROM node:${NODE_VERSION}-alpine as base

ARG PNPM_VERSION=10.2

WORKDIR /app
RUN npm install -g pnpm@${PNPM_VERSION}

FROM base as deps

COPY pnpm-lock.yaml .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm fetch

COPY package.json .
RUN pnpm install --offline --frozen-lockfile


FROM deps as build
COPY . .
COPY --from=deps /app/node_modules ./node_modules
RUN pnpm build
RUN pnpm prune --prod
RUN ( wget -q -O /dev/stdout https://gobinaries.com/tj/node-prune | sh ) \
 && node-prune

FROM node:${NODE_VERSION}-alpine as final

WORKDIR /app

RUN apk add dumb-init

ENV NODE_ENV production
USER node

COPY package.json .
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist .

EXPOSE 3200

CMD ["dumb-init", "node", "/app/index.js"]
