# Build from the repo root: `docker build -t washero-backend -f backend/Dockerfile .`
# (needs supabase/migrations from outside backend/, which Docker can only COPY in if the
# build context is the repo root).
FROM node:20-alpine

WORKDIR /app

COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev

COPY backend/. .
COPY supabase/migrations ./supabase/migrations

ENV NODE_ENV=production
EXPOSE 8000

CMD ["npx", "tsx", "src/index.ts"]
