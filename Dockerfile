FROM node:20-alpine

RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies first (better caching)
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Copy prisma schema and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Copy app source and build
COPY . .
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

EXPOSE 3000

# Run migrations and start server
CMD ["npm", "run", "docker-start"]
