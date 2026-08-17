FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps ./apps
RUN npm install
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY apps/server/package.json ./apps/server/package.json
RUN cd apps/server && npm install --omit=dev
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/client/dist ./apps/client/dist
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
