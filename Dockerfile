FROM node:24-bookworm-slim AS frontend
WORKDIR /build/react-frontend
COPY react-frontend/package*.json ./
RUN npm ci
COPY react-frontend/ ./
RUN npm run build

FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY student_registration.js password_routes.js package.json server_studyflow_v2.js start_prod.js app_records.js admin_routes.js campus_routes.js discussion_routes.js file_routes.js learning_routes.js notification_routes.js local_dev_store.js ./
COPY --from=frontend /build/react-frontend/dist ./react-frontend/dist
RUN mkdir -p /data/uploads /data/private-files && chown -R node:node /data
COPY deploy/migrate-student-registration.cjs ./deploy/migrate-student-registration.cjs
USER node
EXPOSE 3000
CMD ["node", "start_prod.js"]
