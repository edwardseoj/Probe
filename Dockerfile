FROM node:22-alpine AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsup.config.ts ./
COPY src ./src
RUN corepack enable \
  && corepack prepare pnpm@10.30.2 --activate \
  && pnpm install --frozen-lockfile \
  && pnpm build \
  && mkdir /runtime \
  && cp package.json /runtime \
  && cp pnpm-lock.yaml /runtime \
  && cp pnpm-workspace.yaml /runtime

# prod-only install for the runtime stage; tsup marks package.json "dependencies"
# as external, so the runtime image needs them in node_modules.
RUN cd /runtime \
  && pnpm install --frozen-lockfile --prod \
  && rm pnpm-lock.yaml pnpm-workspace.yaml

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /runtime/package.json ./package.json
RUN chmod +x dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/probe
USER node
ENTRYPOINT ["probe"]
