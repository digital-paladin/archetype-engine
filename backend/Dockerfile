FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "-r", "dotenv/config", "dist/server.js"]
